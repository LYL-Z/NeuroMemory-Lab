"""Explicit, local-only commands. Never silently scans or imports user data."""

from argparse import ArgumentParser
import json
from pathlib import Path

from .vault import MemoryVault, VaultError


def _print(value) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main() -> None:
    parser = ArgumentParser(prog="neuromemory_cortex", description="NeuroMemory Cortex phase-1")
    parser.add_argument("--data-dir", type=Path, default=Path("./NeuroMemoryData"),
                        help="Local data vault; created empty if it does not exist")
    commands = parser.add_subparsers(dest="cmd", required=True)
    commands.add_parser("init", help="Initialize an empty vault (no imports)")
    commands.add_parser("stats", help="Inspect database and audit integrity")
    commands.add_parser("sources", help="List original sources")
    commands.add_parser("claims", help="List user-proposed memory statements")
    commands.add_parser("neural-demo", help="Run synthetic LIF/STDP/Hopfield science demo")
    verify = commands.add_parser("verify", help="Check original-file SHA-256")
    verify.add_argument("source_id")
    search = commands.add_parser("search", help="Literal Chinese/English text search")
    search.add_argument("query")
    imported = commands.add_parser("import-file", help="Import only one explicitly selected file")
    imported.add_argument("file", type=Path)
    imported.add_argument("--confirm", action="store_true", help="Required explicit approval")
    imported.add_argument("--classification", choices=("private", "restricted", "public"),
                          default="private")
    revoked = commands.add_parser("revoke", help="Hide source from retrieval; raw archive remains")
    revoked.add_argument("source_id")
    revoked.add_argument("--confirm", action="store_true", help="Required explicit approval")
    serve = commands.add_parser("serve", help="Start localhost UI with no external API access")
    serve.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    try:
        with MemoryVault(args.data_dir) as vault:
            if args.cmd == "init":
                _print({"result": "empty_vault_ready", "data_dir": str(vault.root),
                        "stats": vault.stats()})
            elif args.cmd == "stats":
                _print(vault.stats())
            elif args.cmd == "sources":
                _print(vault.list_sources())
            elif args.cmd == "claims":
                _print(vault.list_claims())
            elif args.cmd == "neural-demo":
                from .associative import synthetic_neural_demo
                _print(synthetic_neural_demo())
            elif args.cmd == "verify":
                _print({"source_id": args.source_id, "sha256_matches": vault.verify_source(args.source_id)})
            elif args.cmd == "search":
                _print(vault.search(args.query))
            elif args.cmd == "import-file":
                _print(vault.import_file(args.file, consent=args.confirm,
                                         classification=args.classification))
            elif args.cmd == "revoke":
                _print(vault.revoke_source(args.source_id, consent=args.confirm))
            elif args.cmd == "serve":
                from .server import serve_local
                serve_local(vault, port=args.port)
    except VaultError as exc:
        parser.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
