"""Деталь принадлежит раскрою.

Без этого два раскроя одной пары «материал + толщина» тянули одни и те же
детали: разложил второй — у первого детали разъехались по чужим листам.

Revision ID: 0007_job_ownership
Revises: 0006_workshop_flow
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_job_ownership"
down_revision: str | None = "0006_workshop_flow"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("parts", sa.Column("job_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_parts_job_id", "parts", "nesting_jobs", ["job_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_parts_job", "parts", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_parts_job", table_name="parts")
    op.drop_constraint("fk_parts_job_id", "parts", type_="foreignkey")
    op.drop_column("parts", "job_id")
