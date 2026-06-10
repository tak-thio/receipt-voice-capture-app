#!/usr/bin/env python3
"""Bootstrap / update a platform operator (運営) account.

This creates the account one level above firm_owner — the operator that
provisions and manages 税理士事務所 (firms). There is no operator above it, so
the first one is created here out-of-band.

Run inside the api container, e.g.:

    docker compose exec api python scripts/create_operator.py \
        --email ops@example.com --name "運営"

If --password is omitted a strong one is generated and printed. Re-running with
an existing --email updates that operator's password/name and re-activates it.
"""

import argparse
import asyncio
import os
import secrets
import string
import sys

# Allow `python scripts/create_operator.py` from the api/ dir: put the package
# root (the parent of scripts/) on sys.path so `import app` resolves.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import Operator  # noqa: E402
from app.security import hash_password  # noqa: E402


def _generate_password(length: int = 24) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def _run(email: str, name: str, password: str) -> None:
    async with SessionLocal() as session:
        async with session.begin():
            operator = await session.scalar(select(Operator).where(Operator.email == email))
            if operator:
                if name:
                    operator.name = name
                operator.password_hash = hash_password(password)
                operator.status = "active"
                action = "updated"
            else:
                operator = Operator(
                    email=email,
                    name=name,
                    password_hash=hash_password(password),
                    status="active",
                )
                session.add(operator)
                action = "created"
            await session.flush()
            op_id = str(operator.id)

    print(f"operator {action}: {email}  (id={op_id})")
    print(f"password: {password}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update a platform operator (運営).")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="")
    parser.add_argument("--password", default=None, help="omit to auto-generate a strong one")
    args = parser.parse_args()
    password = args.password or _generate_password()
    asyncio.run(_run(args.email, args.name, password))


if __name__ == "__main__":
    main()
