"""Create a mentor and print its bearer token ONCE (only the hash is stored): python -m app.mentor_cli create --team team_fs_001"""
import argparse

from app.agents.repository import Repo
from app.auth import hash_token, new_token


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create")
    c.add_argument("--team", required=True)
    c.add_argument("--mentor-id", default="MENTOR001")
    c.add_argument("--name", default="Demo Mentor")
    args = p.parse_args()
    repo = Repo()
    if not repo.one("teams", team_id=args.team):
        raise SystemExit(f"Team {args.team} does not exist (run the seed first).")
    token = new_token()
    repo.upsert("mentors", {"mentor_id": args.mentor_id, "team_id": args.team, "name": args.name,
                            "token_hash": hash_token(token), "active": True}, "mentor_id")
    print(f"mentor_id={args.mentor_id} team={args.team}\nBearer token (shown once, store it safely):\n{token}")


if __name__ == "__main__":
    main()
