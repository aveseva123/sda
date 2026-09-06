"""Склад листов, деловой отход и габариты листов из чертежа.

Что меняется и почему:

* ``stock_items`` заменяет ``offcuts``. Целый лист и обрезок — одна
  сущность: обрезок режут так же, как лист, и от него так же остаётся
  обрезок. Двумя таблицами эта рекурсия дублировалась бы.
* ``stock_movements`` — журнал движений склада, чтобы на вопрос «куда делся
  лист» был ответ.
* ``import_files.detected_sheets`` — габариты листов, найденные в чертеже
  на слое контуров листа. Технолог подтверждает их и заводит формат листа.
* ``sheets.offcut_id`` -> ``sheets.stock_item_id``: раскрой может идти
  по деловому отходу.

Revision ID: 0002_stock
Revises: 0001_initial
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_stock"
down_revision: str | None = "0001_initial"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stock_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("material_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("source_item_id", sa.Integer(), nullable=True),
        sa.Column("source_sheet_id", sa.Integer(), nullable=True),
        sa.Column("geometry", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_item_id"], ["stock_items.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stock_items_material", "stock_items", ["material_id"])
    op.create_index("ix_stock_items_status", "stock_items", ["status"])

    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor", sa.String(length=120), nullable=True),
        sa.Column("offcut_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["item_id"], ["stock_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["offcut_id"], ["stock_items.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stock_movements_item", "stock_movements", ["item_id"])
    op.create_foreign_key(
        "fk_stock_items_source_sheet_id", "stock_items", "sheets",
        ["source_sheet_id"], ["id"], ondelete="SET NULL",
    )

    # Раскрой может идти по деловому отходу — ссылка переезжает на склад.
    op.drop_constraint("sheets_offcut_id_fkey", "sheets", type_="foreignkey")
    op.alter_column("sheets", "offcut_id", new_column_name="stock_item_id")
    op.create_foreign_key(
        "fk_sheets_stock_item_id", "sheets", "stock_items",
        ["stock_item_id"], ["id"], ondelete="SET NULL",
    )

    op.add_column(
        "import_files",
        sa.Column("detected_sheets", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.drop_constraint("fk_offcuts_source_sheet_id", "offcuts", type_="foreignkey")
    op.drop_table("offcuts")


def downgrade() -> None:
    op.create_table(
        "offcuts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_sheet_id", sa.Integer(), nullable=True),
        sa.Column("material_id", sa.Integer(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("geometry", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("available", sa.Boolean(), nullable=False),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_foreign_key(
        "fk_offcuts_source_sheet_id", "offcuts", "sheets",
        ["source_sheet_id"], ["id"], ondelete="SET NULL",
    )

    op.drop_column("import_files", "detected_sheets")

    op.drop_constraint("fk_sheets_stock_item_id", "sheets", type_="foreignkey")
    op.alter_column("sheets", "stock_item_id", new_column_name="offcut_id")
    op.create_foreign_key(
        "sheets_offcut_id_fkey", "sheets", "offcuts",
        ["offcut_id"], ["id"], ondelete="SET NULL",
    )

    op.drop_constraint("fk_stock_items_source_sheet_id", "stock_items", type_="foreignkey")
    op.drop_index("ix_stock_movements_item", table_name="stock_movements")
    op.drop_table("stock_movements")
    op.drop_index("ix_stock_items_status", table_name="stock_items")
    op.drop_index("ix_stock_items_material", table_name="stock_items")
    op.drop_table("stock_items")
