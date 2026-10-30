"""Phase-1 memory kernel: immutable sources, provenance, review and search.

This module deliberately does NOT interpret a user's psychology, import any
data automatically, call an LLM, access the network, or modify itself.
Every import requires an affirmative consent flag, and every proposed claim
requires a separate explicit review action before becoming confirmed.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import unicodedata
import uuid


MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_SEARCH_CHARS = 200
MAX_PASSAGE_CHARS = 900
CLASSIFICATIONS = {"private", "restricted", "public"}
CLAIM_KINDS = {"episodic", "semantic", "procedural", "self_model"}


class VaultError(ValueError):
    """A safe error to report to a local user without exposing internals."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _id() -> str:
    return str(uuid.uuid4())


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _make_passages(content: str):
    """Yield offset-correct text spans, grouped by paragraphs and length.

    ``content[start:end] == passage`` is an invariant, unlike summaries.
    """
    breaks = list(re.finditer(r"\n[\t ]*\n+", content))
    bounds = [0] + [m.end() for m in breaks] + [len(content)]
    for left, right in zip(bounds[:-1], bounds[1:]):
        segment = content[left:right]
        start = left + len(segment) - len(segment.lstrip())
        end = right - (len(segment) - len(segment.rstrip()))
        while start < end:
            cutoff = min(start + MAX_PASSAGE_CHARS, end)
            yield start, cutoff, content[start:cutoff]
            start = cutoff


class MemoryVault:
    """Small, inspectable memory store. One process, concurrent local threads."""

    def __init__(self, root: str | Path):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.raw_root = self.root / "raw"
        self.raw_root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.db_path = self.root / "memory.sqlite3"
        self.db = sqlite3.connect(str(self.db_path), check_same_thread=False, timeout=15.0)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA busy_timeout=10000")
        self.db.execute("PRAGMA journal_mode=WAL")
        self._init_schema()

    def close(self) -> None:
        with self._lock:
            self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _init_schema(self) -> None:
        with self._lock:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS sources (
                    id TEXT PRIMARY KEY,
                    original_name TEXT NOT NULL,
                    content_sha256 TEXT NOT NULL,
                    bytes INTEGER NOT NULL,
                    classification TEXT NOT NULL,
                    origin TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    raw_relative_path TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('active','revoked'))
                );
                CREATE INDEX IF NOT EXISTS idx_sources_sha ON sources(content_sha256, status);
                CREATE TABLE IF NOT EXISTS passages (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL REFERENCES sources(id),
                    ordinal INTEGER NOT NULL,
                    start_char INTEGER NOT NULL,
                    end_char INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    UNIQUE(source_id, ordinal)
                );
                CREATE INDEX IF NOT EXISTS idx_passage_source ON passages(source_id);
                CREATE TABLE IF NOT EXISTS claims (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL REFERENCES sources(id),
                    passage_id TEXT NOT NULL REFERENCES passages(id),
                    kind TEXT NOT NULL,
                    statement TEXT NOT NULL,
                    perspective TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected')),
                    created_at TEXT NOT NULL,
                    reviewed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_claim_source ON claims(source_id, status);
                CREATE TABLE IF NOT EXISTS audit_events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    action TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    prev_hash TEXT NOT NULL,
                    digest TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS schema_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                INSERT OR IGNORE INTO schema_meta(key,value) VALUES('version','1');
            """)
            version = self.db.execute(
                "SELECT value FROM schema_meta WHERE key='version'"
            ).fetchone()[0]
            if version != "1":
                raise RuntimeError("Unsupported vault schema; migration is required.")
            self.fts_available = True
            try:
                self.db.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts "
                    "USING fts5(content, passage_id UNINDEXED, tokenize='trigram')"
                )
            except sqlite3.OperationalError:
                self.fts_available = False
            self.db.commit()

    def _audit(self, action: str, entity_id: str, metadata: dict) -> None:
        timestamp = _now()
        prev_row = self.db.execute(
            "SELECT digest FROM audit_events ORDER BY seq DESC LIMIT 1"
        ).fetchone()
        previous = prev_row[0] if prev_row else "GENESIS"
        payload = _canonical(metadata)
        body = _canonical([timestamp, action, entity_id, payload, previous])
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        self.db.execute(
            "INSERT INTO audit_events(created_at,action,entity_id,payload,prev_hash,digest) "
            "VALUES(?,?,?,?,?,?)", (timestamp, action, entity_id, payload, previous, digest)
        )

    def audit_integrity(self) -> bool:
        with self._lock:
            previous = "GENESIS"
            for row in self.db.execute("SELECT * FROM audit_events ORDER BY seq ASC"):
                body = _canonical([row["created_at"], row["action"], row["entity_id"],
                                   row["payload"], previous])
                if row["prev_hash"] != previous:
                    return False
                if hashlib.sha256(body.encode("utf-8")).hexdigest() != row["digest"]:
                    return False
                previous = row["digest"]
            return True

    @staticmethod
    def _clean_filename(name: str) -> str:
        safe = str(name).replace("\\", "/").split("/")[-1].strip()
        if not safe or len(safe) > 180 or any(ord(ch) < 32 for ch in safe):
            raise VaultError("文件名为空、过长或包含控制字符。")
        if Path(safe).suffix.lower() not in {".txt", ".md"}:
            raise VaultError("第一阶段只支持 UTF-8 编码的 .txt 和 .md。")
        return safe

    def import_bytes(self, name: str, raw_bytes: bytes, *, consent: bool,
                     classification: str = "private", origin: str = "explicit_local_import") -> dict:
        if consent is not True:
            raise VaultError("导入需要用户明确勾选授权。")
        name = self._clean_filename(name)
        if classification not in CLASSIFICATIONS:
            raise VaultError("未知的隐私分类。")
        if not raw_bytes or len(raw_bytes) > MAX_SOURCE_BYTES:
            raise VaultError("文件必须非空且不超过 2 MiB。")
        try:
            decoded = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise VaultError("当前仅支持 UTF-8 文本编码。") from exc
        if "\x00" in decoded or not decoded.strip():
            raise VaultError("文件不包含可导入的正常文本。")
        digest = hashlib.sha256(raw_bytes).hexdigest()
        spans = list(_make_passages(decoded))
        if not spans:
            raise VaultError("未发现有效文本片段。")
        sid = _id()
        relative = f"raw/{digest[:2]}/{digest}.blob"
        raw_file = self.root / relative
        with self._lock:
            existing = self.db.execute(
                "SELECT id FROM sources WHERE content_sha256=? AND status='active' "
                "ORDER BY created_at LIMIT 1", (digest,)
            ).fetchone()
            if existing:
                return {"id": existing["id"], "duplicate": True, "passages": 0}
            raw_file.parent.mkdir(parents=True, exist_ok=True)
            if not raw_file.exists():
                temporary = raw_file.with_name(f"{digest}.{_id()}.tmp")
                try:
                    with temporary.open("xb") as handle:
                        handle.write(raw_bytes)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.replace(temporary, raw_file)
                finally:
                    if temporary.exists():
                        temporary.unlink()
            elif hashlib.sha256(raw_file.read_bytes()).hexdigest() != digest:
                raise VaultError("归档文件哈希不匹配，已拒绝建立新的来源引用。")
            with self.db:
                self.db.execute(
                    "INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)",
                    (sid, name, digest, len(raw_bytes), classification, origin,
                     _now(), relative, "active")
                )
                for ordinal, (start, end, content) in enumerate(spans):
                    pid = _id()
                    self.db.execute(
                        "INSERT INTO passages VALUES(?,?,?,?,?,?)",
                        (pid, sid, ordinal, start, end, content)
                    )
                    if self.fts_available:
                        self.db.execute(
                            "INSERT INTO passage_fts(content,passage_id) VALUES(?,?)",
                            (content, pid)
                        )
                self._audit("import", sid, {"sha256": digest, "bytes": len(raw_bytes),
                                            "passages": len(spans), "classification": classification})
        return {"id": sid, "duplicate": False, "passages": len(spans)}

    def import_file(self, path: str | Path, *, consent: bool,
                    classification: str = "private") -> dict:
        """Only called after an explicit CLI choice; never scans folders."""
        file = Path(path)
        if not file.is_file() or file.stat().st_size > MAX_SOURCE_BYTES:
            raise VaultError("导入目标不存在、不是文件，或超过 2 MiB。")
        return self.import_bytes(file.name, file.read_bytes(), consent=consent,
                                 classification=classification)

    def list_sources(self) -> list[dict]:
        with self._lock:
            rows = self.db.execute(
                "SELECT id,original_name,content_sha256,bytes,classification,"
                "created_at,status FROM sources ORDER BY created_at DESC,id DESC"
            ).fetchall()
            return [dict(row) for row in rows]

    def list_passages(self, source_id: str) -> list[dict]:
        with self._lock:
            active = self.db.execute(
                "SELECT id FROM sources WHERE id=? AND status='active'", (source_id,)
            ).fetchone()
            if not active:
                return []
            rows = self.db.execute(
                "SELECT id,source_id,ordinal,start_char,end_char,content "
                "FROM passages WHERE source_id=? ORDER BY ordinal", (source_id,)
            ).fetchall()
            return [dict(r) for r in rows]

    def verify_source(self, source_id: str) -> bool:
        with self._lock:
            row = self.db.execute(
                "SELECT raw_relative_path,content_sha256 FROM sources WHERE id=?", (source_id,)
            ).fetchone()
            if row is None:
                raise VaultError("来源不存在。")
            file = self.root / row["raw_relative_path"]
            if not file.resolve().is_relative_to(self.raw_root):
                return False
            return file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest() == row["content_sha256"]

    def search(self, query: str, limit: int = 25) -> list[dict]:
        query = unicodedata.normalize("NFC", str(query)).strip()
        if not query or len(query) > MAX_SEARCH_CHARS:
            raise VaultError("检索词必须为 1–200 个字符。")
        limit = min(max(int(limit), 1), 50)
        with self._lock:
            if self.fts_available and len(query) >= 3:
                escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                rows = self.db.execute(
                    "SELECT p.id,p.source_id,p.start_char,p.end_char,p.content,"
                    "s.original_name,s.created_at FROM passage_fts f "
                    "JOIN passages p ON p.id=f.passage_id "
                    "JOIN sources s ON s.id=p.source_id "
                    "WHERE f.content LIKE ? ESCAPE '\\' AND instr(f.content,?)>0 "
                    "AND s.status='active' "
                    "ORDER BY s.created_at DESC,p.ordinal LIMIT ?",
                    (f"%{escaped}%", query, limit)
                ).fetchall()
            else:
                rows = self.db.execute(
                    "SELECT p.id,p.source_id,p.start_char,p.end_char,p.content,"
                    "s.original_name,s.created_at FROM passages p "
                    "JOIN sources s ON s.id=p.source_id "
                    "WHERE instr(p.content,?)>0 AND s.status='active' "
                    "ORDER BY s.created_at DESC,p.ordinal LIMIT ?", (query, limit)
                ).fetchall()
            return [{**dict(row), "retrieval_method": "literal_substring"} for row in rows]

    def propose_claim(self, *, source_id: str, passage_id: str, statement: str,
                      kind: str, perspective: str = "user_written") -> dict:
        if kind not in CLAIM_KINDS:
            raise VaultError("不支持的记忆类型。")
        statement = statement.strip()
        if not statement or len(statement) > 1200:
            raise VaultError("记忆陈述长度必须在 1–1200 字符之间。")
        if perspective not in {"user_written", "source_quote", "assistant_hypothesis"}:
            raise VaultError("不支持的叙述来源。")
        with self._lock, self.db:
            ok = self.db.execute(
                "SELECT p.id FROM passages p JOIN sources s ON s.id=p.source_id "
                "WHERE p.id=? AND p.source_id=? AND s.status='active'",
                (passage_id, source_id)
            ).fetchone()
            if not ok:
                raise VaultError("来源片段不存在或已撤销。")
            cid = _id()
            self.db.execute(
                "INSERT INTO claims VALUES(?,?,?,?,?,?,?,?,?)",
                (cid, source_id, passage_id, kind, statement, perspective,
                 "pending", _now(), None)
            )
            self._audit("propose_claim", cid, {"source_id": source_id, "kind": kind})
            return {"id": cid, "status": "pending"}

    def review_claim(self, claim_id: str, decision: str, *, consent: bool) -> dict:
        if consent is not True:
            raise VaultError("确认或拒绝记忆需要明确授权。")
        if decision not in {"confirmed", "rejected"}:
            raise VaultError("审核决定必须是 confirmed 或 rejected。")
        with self._lock, self.db:
            row = self.db.execute(
                "SELECT c.status,s.status AS source_status FROM claims c "
                "JOIN sources s ON s.id=c.source_id WHERE c.id=?", (claim_id,)
            ).fetchone()
            if row is None or row["source_status"] != "active":
                raise VaultError("记忆候选不存在或来源已撤销。")
            if row["status"] != "pending":
                raise VaultError("已审核记忆不可在此接口重复改写；后续使用版本修订流程。")
            self.db.execute("UPDATE claims SET status=?,reviewed_at=? WHERE id=?",
                            (decision, _now(), claim_id))
            self._audit("review_claim", claim_id, {"decision": decision})
            return {"id": claim_id, "status": decision}

    def list_claims(self, source_id: str | None = None) -> list[dict]:
        with self._lock:
            sql = ("SELECT c.* FROM claims c JOIN sources s ON s.id=c.source_id "
                   "WHERE s.status='active'")
            params: tuple = ()
            if source_id:
                sql += " AND c.source_id=?"
                params = (source_id,)
            rows = self.db.execute(sql + " ORDER BY c.created_at DESC,c.id DESC", params).fetchall()
            return [dict(r) for r in rows]

    def revoke_source(self, source_id: str, *, consent: bool) -> dict:
        """Revoke visibility; keep original archived for explicit later deletion.

        Phase 1 does not implement irreversible erasure. UI labels this clearly.
        """
        if consent is not True:
            raise VaultError("撤销导入需要明确授权。")
        with self._lock, self.db:
            row = self.db.execute("SELECT status FROM sources WHERE id=?", (source_id,)).fetchone()
            if row is None:
                raise VaultError("来源不存在。")
            if row["status"] == "revoked":
                return {"id": source_id, "status": "revoked", "already_revoked": True}
            self.db.execute("UPDATE sources SET status='revoked' WHERE id=?", (source_id,))
            if self.fts_available:
                self.db.execute(
                    "DELETE FROM passage_fts WHERE passage_id IN "
                    "(SELECT id FROM passages WHERE source_id=?)", (source_id,)
                )
            self._audit("revoke_source", source_id, {"search_visibility": "removed",
                                                      "raw_retained": True})
            return {"id": source_id, "status": "revoked", "already_revoked": False}

    def stats(self) -> dict:
        with self._lock:
            source_count = self.db.execute(
                "SELECT count(*) FROM sources WHERE status='active'"
            ).fetchone()[0]
            passage_count = self.db.execute(
                "SELECT count(*) FROM passages p JOIN sources s ON s.id=p.source_id "
                "WHERE s.status='active'"
            ).fetchone()[0]
            pending_count = self.db.execute(
                "SELECT count(*) FROM claims c JOIN sources s ON s.id=c.source_id "
                "WHERE c.status='pending' AND s.status='active'"
            ).fetchone()[0]
            return {"active_sources": source_count, "active_passages": passage_count,
                    "pending_claims": pending_count, "audit_valid": self.audit_integrity(),
                    "search_backend": "sqlite_fts5_trigram" if self.fts_available else "sqlite_substring"}
