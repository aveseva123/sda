"""Работа цеха: оператор, стадии раскроя, чеклист, изделие, магазин фрез.

Порядок работы поменялся: сначала заводится раскрой (материал, толщина,
оператор), и уже в него добавляются DXF. У листа появилась жизнь — «взял в
работу» и «раскрой завершён» по чеклисту, — а у детали изделие рядом с
проектом: после раскроя детали сортируют именно по ним.

Фреза научилась знать свой слот в магазине станка, ресурс и режимы по
материалам: смена инструмента ручная, и что стоит в станке — важно.

Revision ID: 0006_workshop_flow
Revises: 0005_cutting_presets
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_workshop_flow"
down_revision: str | None = "0005_cutting_presets"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column("nesting_jobs", sa.Column("operator", sa.String(length=120), nullable=True))
    op.add_column(
        "nesting_jobs",
        sa.Column("stage", sa.String(length=32), nullable=False, server_default="planning"),
    )
    op.add_column(
        "nesting_jobs", sa.Column("taken_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "nesting_jobs", sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("nesting_jobs", sa.Column("checklist", JSONB, nullable=True))

    op.add_column("parts", sa.Column("product_name", sa.String(length=200), nullable=True))

    op.add_column("tools", sa.Column("slot", sa.Integer(), nullable=True))
    op.add_column("tools", sa.Column("flute_length", sa.Float(), nullable=True))
    op.add_column("tools", sa.Column("total_length", sa.Float(), nullable=True))
    op.add_column("tools", sa.Column("flutes", sa.Integer(), nullable=True))
    op.add_column("tools", sa.Column("shank", sa.Float(), nullable=True))
    op.add_column("tools", sa.Column("article", sa.String(length=64), nullable=True))
    op.add_column(
        "tools",
        sa.Column("resource_used", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column("tools", sa.Column("resource_limit", sa.Float(), nullable=True))
    op.add_column(
        "tools",
        sa.Column("resource_unit", sa.String(length=16), nullable=False, server_default="м"),
    )
    op.add_column("tools", sa.Column("modes", JSONB, nullable=True))
    op.add_column(
        "tools",
        sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    for column in (
        "is_builtin", "modes", "resource_unit", "resource_limit", "resource_used",
        "article", "shank", "flutes", "total_length", "flute_length", "slot",
    ):
        op.drop_column("tools", column)

    op.drop_column("parts", "product_name")

    for column in ("checklist", "finished_at", "taken_at", "stage", "operator"):
        op.drop_column("nesting_jobs", column)
