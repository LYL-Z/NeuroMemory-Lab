"""Synthetic-only tests. No user files, accounts, network services or API keys."""

import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from neuromemory_cortex.vault import MemoryVault, VaultError


SYNTHETIC_TEXT = (
    "这是虚构测试人物小林的研究日志。\n"
    "他在虚构城市的实验室研究一个光学装置。\n\n"
    "第二天，小林在白板上写下虚构的测试结论。\n"
)


class VaultTestCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="neuro-cortex-test-")
        self.vault = MemoryVault(Path(self.temp.name) / "vault")

    def tearDown(self):
        self.vault.close()
        self.temp.cleanup()

    def _import(self):
        return self.vault.import_bytes("fictitious_notes.md", SYNTHETIC_TEXT.encode("utf-8"), consent=True)

    def test_empty_vault_and_no_real_data(self):
        self.assertEqual(self.vault.stats()["active_sources"], 0)
        self.assertTrue(self.vault.audit_integrity())
        self.assertEqual(self.vault.list_sources(), [])

    def test_explicit_consent_required(self):
        with self.assertRaises(VaultError):
            self.vault.import_bytes("fake.md", b"synthetic", consent=False)
        self.assertEqual(self.vault.list_sources(), [])

    def test_exact_source_hash_and_source_offsets(self):
        result = self._import()
        self.assertFalse(result["duplicate"])
        source = self.vault.list_sources()[0]
        self.assertEqual(source["content_sha256"], hashlib.sha256(SYNTHETIC_TEXT.encode()).hexdigest())
        self.assertTrue(self.vault.verify_source(result["id"]))
        parts = self.vault.list_passages(result["id"])
        self.assertEqual(len(parts), 2)
        for part in parts:
            self.assertEqual(SYNTHETIC_TEXT[part["start_char"]:part["end_char"]], part["content"])

    def test_chinese_trigram_and_short_query(self):
        self._import()
        self.assertEqual(len(self.vault.search("虚构城市")), 1)
        self.assertEqual(len(self.vault.search("小林")), 2)
        self.assertEqual(self.vault.search("不存在的短语"), [])

    def test_duplicate_does_not_create_second_active_source(self):
        self._import()
        second = self.vault.import_bytes("renamed.md", SYNTHETIC_TEXT.encode(), consent=True)
        self.assertTrue(second["duplicate"])
        self.assertEqual(self.vault.stats()["active_sources"], 1)

    def test_literal_wildcard_not_sql_wildcard(self):
        self._import()
        self.assertEqual(self.vault.search("%"), [])
        self.assertEqual(self.vault.search("_"), [])

    def test_english_search_is_literal_and_case_sensitive(self):
        self.vault.import_bytes("imaginary_case.md", b"NeuroCortex meets neuromemory.", consent=True)
        self.assertEqual(len(self.vault.search("Neuro")), 1)
        self.assertEqual(len(self.vault.search("neuro")), 1)
        self.assertEqual(self.vault.search("NEURO"), [])

    def test_revocation_removes_access_not_raw(self):
        record = self._import()
        with self.assertRaises(VaultError):
            self.vault.revoke_source(record["id"], consent=False)
        self.vault.revoke_source(record["id"], consent=True)
        self.assertEqual(self.vault.search("虚构城市"), [])
        self.assertEqual(self.vault.list_passages(record["id"]), [])
        self.assertEqual(self.vault.stats()["active_sources"], 0)
        # Revocation deliberately does not claim secure physical deletion.
        self.assertTrue(self.vault.verify_source(record["id"]))
        self.assertTrue(self.vault.audit_integrity())

    def test_manual_claim_review_gate(self):
        source = self._import()
        passage = self.vault.list_passages(source["id"])[0]
        candidate = self.vault.propose_claim(
            source_id=source["id"], passage_id=passage["id"],
            statement="虚构人物小林参加了一个虚构实验。", kind="episodic"
        )
        self.assertEqual(candidate["status"], "pending")
        self.assertEqual(self.vault.stats()["pending_claims"], 1)
        with self.assertRaises(VaultError):
            self.vault.review_claim(candidate["id"], "confirmed", consent=False)
        self.vault.review_claim(candidate["id"], "confirmed", consent=True)
        self.assertEqual(self.vault.list_claims()[0]["status"], "confirmed")
        with self.assertRaises(VaultError):
            self.vault.review_claim(candidate["id"], "rejected", consent=True)

    def test_cannot_link_claim_to_wrong_source(self):
        first = self._import()
        second = self.vault.import_bytes("other.txt", b"Made-up second example.", consent=True)
        passage = self.vault.list_passages(first["id"])[0]
        with self.assertRaises(VaultError):
            self.vault.propose_claim(source_id=second["id"], passage_id=passage["id"],
                                     statement="Unsupported memory", kind="self_model")

    def test_invalid_text_and_path_are_rejected(self):
        for name, data in [("secret.exe", b"not a source"), ("empty.md", b""),
                           ("binary.txt", b"\xff\xfe\x00"), ("blank.txt", b"   ")]:
            with self.subTest(name=name), self.assertRaises(VaultError):
                self.vault.import_bytes(name, data, consent=True)
        self.assertEqual(self.vault.stats()["active_sources"], 0)

    def test_size_and_query_limits(self):
        with self.assertRaises(VaultError):
            self.vault.import_bytes("huge.txt", b"a" * (2 * 1024 * 1024 + 1), consent=True)
        with self.assertRaises(VaultError):
            self.vault.search("字" * 201)

    def test_audit_detects_database_tampering(self):
        self._import()
        self.assertTrue(self.vault.audit_integrity())
        with self.vault.db:
            self.vault.db.execute("UPDATE audit_events SET payload=? WHERE seq=1",
                                  (json.dumps({"fabricated": True}),))
        self.assertFalse(self.vault.audit_integrity())

    def test_reimport_after_revocation(self):
        first = self._import()
        self.vault.revoke_source(first["id"], consent=True)
        second = self._import()
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(len(self.vault.search("虚构城市")), 1)


if __name__ == "__main__":
    unittest.main()
