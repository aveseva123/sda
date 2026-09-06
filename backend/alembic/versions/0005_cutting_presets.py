"""Пресеты раскроя со словарём ArtCAM.

Технолог настраивает раскрой материала один раз, а не отвечает на диалог
по каждой траектории: пресет подбирается по паре «материал + толщина».
Задание хранит и ссылку на пресет, и снимок его параметров — правка
пресета не должна незаметно менять уже посчитанный раскрой, а старую УП
надо уметь повторить точь-в-точь.

Revision ID: 0005_cutting_presets
Revises: 0004_orders
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_cutting_presets"
down_revision: str | None = "0004_orders"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "cutting_presets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("is_builtin", sa.Boolean(), nullable=False),
        sa.Column("applies_to", JSONB, nullable=False),
        sa.Column("placement", JSONB, nullable=False),
        sa.Column("depth", JSONB, nullable=False),
        sa.Column("strategy", JSONB, nullable=False),
        sa.Column("tools", JSONB, nullable=False),
        sa.Column("order", JSONB, nullable=False),
        sa.Column("safety", JSONB, nullable=False),
        sa.Column("post", JSONB, nullable=False),
        sa.Column("last_utilization", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_cutting_presets_slug"),
    )

    op.add_column("nesting_jobs", sa.Column("preset_id", sa.Integer(), nullable=True))
    op.add_column("nesting_jobs", sa.Column("preset_snapshot", JSONB, nullable=True))
    op.create_foreign_key(
        "fk_nesting_jobs_preset_id", "nesting_jobs", "cutting_presets",
        ["preset_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_nesting_jobs_preset_id", "nesting_jobs", type_="foreignkey")
    op.drop_column("nesting_jobs", "preset_snapshot")
    op.drop_column("nesting_jobs", "preset_id")
    op.drop_table("cutting_presets")
