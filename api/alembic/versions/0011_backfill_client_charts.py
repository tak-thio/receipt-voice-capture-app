"""backfill the standard chart into existing clients

New clients get their own copy of the standard chart at creation
(seed_client_chart). This backfills clients that predate that change: any client
with NO client-scoped account titles gets the standard chart copied in, with
override_of set for codes that match a firm-template row (so the inherited
template row is hidden, no duplicates). Clients that already have their own rows
are left untouched.

Revision ID: 0011_backfill_client_charts
Revises: 0010_notes
"""

import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

from app.seed import STANDARD_CHART

revision = "0011_backfill_client_charts"
down_revision = "0010_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    clients = bind.execute(sa.text("SELECT id, firm_id FROM clients")).fetchall()

    firm_templates: dict = {}  # firm_id -> {code: template_id}
    insert = sa.text(
        "INSERT INTO account_titles "
        "(id, firm_id, client_id, code, name, sort_order, active, override_of, created_at) "
        "VALUES (:id, :fid, :cid, :code, :name, :so, true, :ov, :ca)"
    )

    for cid, fid in clients:
        existing = bind.execute(
            sa.text("SELECT count(*) FROM account_titles WHERE client_id = :cid"),
            {"cid": cid},
        ).scalar()
        if existing and existing > 0:
            continue  # already has its own rows — leave as-is

        if fid not in firm_templates:
            rows = bind.execute(
                sa.text(
                    "SELECT id, code FROM account_titles "
                    "WHERE firm_id = :fid AND client_id IS NULL"
                ),
                {"fid": fid},
            ).fetchall()
            firm_templates[fid] = {code: tid for tid, code in rows}
        by_code = firm_templates[fid]

        for order, (code, name) in enumerate(STANDARD_CHART):
            bind.execute(
                insert,
                {
                    "id": uuid.uuid4(),
                    "fid": fid,
                    "cid": cid,
                    "code": code,
                    "name": name,
                    "so": order,
                    "ov": by_code.get(code),
                    "ca": now,
                },
            )


def downgrade() -> None:
    # No-op: backfilled rows are indistinguishable from user-created client rows.
    pass
