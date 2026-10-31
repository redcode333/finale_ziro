"""Explicit seed command: python -m app.seed [--dry-run]"""
import argparse
import sys

from app.logging_config import setup_logging
from app.services.seed_service import run_seed


def main() -> int:
    parser = argparse.ArgumentParser(description="Import the FairSprint synthetic dataset into Supabase")
    parser.add_argument("--dry-run", action="store_true", help="validate only; do not touch the database")
    args = parser.parse_args()
    setup_logging("INFO")
    result = run_seed(dry_run=args.dry_run)
    print(result.model_dump_json(indent=2))
    return 1 if result.failed else 0


if __name__ == "__main__":
    sys.exit(main())
