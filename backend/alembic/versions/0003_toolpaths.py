"""Пресеты траекторий и их назначение на векторы детали.

Стратегия обработки хранится отдельно от детали, назначение — отдельной
строкой: так один пресет правится сразу во всех деталях, а конкретной
детали можно задать исключение.

Revision ID: 0003_toolpaths
Revises: 0002_stock
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_toolpaths"
down_revision: str | None = "0002_stock"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "toolpath_presets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("semantic", sa.String(length=16), nullable=True),
        sa.Column("side", sa.String(length=16), nullable=False),
        sa.Column("tool_id", sa.Integer(), nullable=True),
        sa.Column("tool_diameter", sa.Float(), nullable=True),
        sa.Column("tool_type", sa.String(length=32), nullable=True),
        sa.Column("depth", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("step_down", sa.Float(), nullable=True),
        sa.Column("finish_pass", sa.Boolean(), nullable=False),
        sa.Column("finish_allowance", sa.Float(), nullable=True),
        sa.Column("direction", sa.String(length=16), nullable=False),
        sa.Column("lead", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("tabs", sa.String(length=16), nullable=False),
        sa.Column("params", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("color", sa.String(length=7), nullable=False),
        sa.Column("is_builtin", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_toolpath_presets_slug"),
    )
    op.create_table(
        "part_toolpaths",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("part_id", sa.Integer(), nullable=False),
        sa.Column("target", sa.String(length=32), nullable=False),
        sa.Column("preset_id", sa.Integer(), nullable=False),
        sa.Column("overrides", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("assigned_manually", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["part_id"], ["parts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["preset_id"], ["toolpath_presets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("part_id", "target", name="uq_part_toolpaths_part_target"),
    )
    op.create_index("ix_part_toolpaths_part", "part_toolpaths", ["part_id"])


def downgrade() -> None:
    op.drop_index("ix_part_toolpaths_part", table_name="part_toolpaths")
    op.drop_table("part_toolpaths")
    op.drop_table("toolpath_presets")
