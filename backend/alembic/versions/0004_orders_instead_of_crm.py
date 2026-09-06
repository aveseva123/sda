"""Заказ вместо проекта и изделия: CRM-слоя в платформе нет.

Заказ — это просто имя, оно лежит текстом на детали. Настоящая единица
принадлежности — файл DXF: он держит цвет, и именно по нему технолог
опознаёт деталь в цеху. Штриховка на карте раскроя размечает номер листа
ВНУТРИ файла: один DXF часто содержит несколько разложенных листов.

Таблицы projects и products удаляются вместе с клиентами, сроками и
оттенками изделий — ничего из этого производству не нужно.

Revision ID: 0004_orders
Revises: 0003_toolpaths
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_orders"
down_revision: str | None = "0003_toolpaths"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Файл получает цвет, заказ и сводку.
    op.add_column("import_files", sa.Column("order_name", sa.String(length=200), nullable=True))
    op.add_column(
        "import_files",
        sa.Column("color_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "import_files",
        sa.Column("color", sa.String(length=7), nullable=False, server_default="#7D82C5"),
    )
    op.add_column(
        "import_files",
        sa.Column("sheets_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "import_files",
        sa.Column("parts_count", sa.Integer(), nullable=False, server_default="0"),
    )

    # Деталь переезжает с изделия на файл.
    op.add_column("parts", sa.Column("source_file_id", sa.Integer(), nullable=True))
    op.add_column(
        "parts",
        sa.Column("source_sheet_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("parts", sa.Column("order_name", sa.String(length=200), nullable=True))
    op.create_foreign_key(
        "fk_parts_source_file_id", "parts", "import_files",
        ["source_file_id"], ["id"], ondelete="CASCADE",
    )
    op.create_index("ix_parts_source_file", "parts", ["source_file_id"])

    op.drop_index("ix_parts_product", table_name="parts")
    op.drop_constraint("parts_product_id_fkey", "parts", type_="foreignkey")
    op.drop_column("parts", "product_id")

    # Спецификация тоже больше не знает про проекты и изделия.
    op.add_column("spec_rows", sa.Column("order_name", sa.String(length=200), nullable=True))
    op.drop_column("spec_rows", "project_name")
    op.drop_column("spec_rows", "product_name")

    op.add_column(
        "import_batches", sa.Column("default_order_name", sa.String(length=200), nullable=True)
    )
    op.drop_constraint("import_batches_default_project_id_fkey", "import_batches", type_="foreignkey")
    op.drop_constraint("import_batches_default_product_id_fkey", "import_batches", type_="foreignkey")
    op.drop_column("import_batches", "default_project_id")
    op.drop_column("import_batches", "default_product_id")

    # Ссылки между файлом и деталью стали взаимными, поэтому FK файла на
    # деталь пересоздаётся именованным: иначе его нельзя создать отдельным
    # ALTER после обеих таблиц.
    op.drop_constraint("import_files_part_id_fkey", "import_files", type_="foreignkey")
    op.create_foreign_key(
        "fk_import_files_part_id", "import_files", "parts",
        ["part_id"], ["id"], ondelete="SET NULL",
    )

    op.drop_table("products")
    op.drop_table("projects")


def downgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("client", sa.String(length=200), nullable=True),
        sa.Column("color_index", sa.Integer(), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=False),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_projects_name"),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=True),
        sa.Column("shade_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_products_project_name"),
    )

    op.add_column("import_batches", sa.Column("default_product_id", sa.Integer(), nullable=True))
    op.add_column("import_batches", sa.Column("default_project_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "import_batches_default_product_id_fkey", "import_batches", "products",
        ["default_product_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "import_batches_default_project_id_fkey", "import_batches", "projects",
        ["default_project_id"], ["id"], ondelete="SET NULL",
    )
    op.drop_column("import_batches", "default_order_name")

    op.add_column("spec_rows", sa.Column("product_name", sa.String(length=200), nullable=True))
    op.add_column("spec_rows", sa.Column("project_name", sa.String(length=200), nullable=True))
    op.drop_column("spec_rows", "order_name")

    op.add_column("parts", sa.Column("product_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "parts_product_id_fkey", "parts", "products", ["product_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_parts_product", "parts", ["product_id"])
    op.drop_index("ix_parts_source_file", table_name="parts")
    op.drop_constraint("fk_parts_source_file_id", "parts", type_="foreignkey")
    op.drop_column("parts", "order_name")
    op.drop_column("parts", "source_sheet_index")
    op.drop_column("parts", "source_file_id")

    op.drop_constraint("fk_import_files_part_id", "import_files", type_="foreignkey")
    op.create_foreign_key(
        "import_files_part_id_fkey", "import_files", "parts",
        ["part_id"], ["id"], ondelete="SET NULL",
    )

    for column in ("parts_count", "sheets_count", "color", "color_index", "order_name"):
        op.drop_column("import_files", column)
