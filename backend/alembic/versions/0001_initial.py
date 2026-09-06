"""Начальная схема: проекты, изделия, детали, материалы, раскрой, импорт.

Revision ID: 0001_initial
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "layer_presets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("rules", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("thickness_from_layer_regex", sa.Text(), nullable=True),
        sa.Column("is_builtin", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_layer_presets_name"),
    )
    op.create_table(
        "materials",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("thickness", sa.Float(), nullable=False),
        sa.Column("has_grain", sa.Boolean(), nullable=False),
        sa.Column("sheet_w", sa.Float(), nullable=False),
        sa.Column("sheet_h", sa.Float(), nullable=False),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("supplier", sa.String(length=200), nullable=True),
        sa.Column("trim_left", sa.Float(), nullable=False),
        sa.Column("trim_right", sa.Float(), nullable=False),
        sa.Column("trim_top", sa.Float(), nullable=False),
        sa.Column("trim_bottom", sa.Float(), nullable=False),
        sa.Column("stock_sheets", sa.Integer(), nullable=True),
        sa.Column("aliases", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", "thickness", name="uq_materials_name_thickness"),
    )
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("client", sa.String(length=200), nullable=True),
        sa.Column("color_index", sa.Integer(), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=False),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_projects_name"),
    )
    op.create_table(
        "tools",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("diameter", sa.Float(), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("rpm", sa.Integer(), nullable=False),
        sa.Column("feed", sa.Float(), nullable=False),
        sa.Column("plunge_feed", sa.Float(), nullable=False),
        sa.Column("step_down", sa.Float(), nullable=False),
        sa.Column("direction", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "material_sheet_formats",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("material_id", sa.Integer(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "nesting_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("material_id", sa.Integer(), nullable=False),
        sa.Column("thickness", sa.Float(), nullable=False),
        sa.Column("params", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("parent_job_id", sa.Integer(), nullable=True),
        sa.Column("utilization", sa.Float(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["parent_job_id"], ["nesting_jobs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
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
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=True),
        sa.Column("shade_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_products_project_name"),
    )
    op.create_table(
        "import_batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("detected_source", sa.String(length=32), nullable=False),
        sa.Column("layer_preset_id", sa.Integer(), nullable=True),
        sa.Column("default_project_id", sa.Integer(), nullable=True),
        sa.Column("default_product_id", sa.Integer(), nullable=True),
        sa.Column("default_material_id", sa.Integer(), nullable=True),
        sa.Column("filename_template", sa.String(length=64), nullable=True),
        sa.Column("stats", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["default_material_id"], ["materials.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["default_product_id"], ["products.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["default_project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["layer_preset_id"], ["layer_presets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "parts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=True),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("length", sa.Float(), nullable=True),
        sa.Column("width", sa.Float(), nullable=True),
        sa.Column("thickness", sa.Float(), nullable=True),
        sa.Column("material_id", sa.Integer(), nullable=True),
        sa.Column("grain", sa.String(length=16), nullable=False),
        sa.Column("edge_top", sa.String(length=64), nullable=True),
        sa.Column("edge_bottom", sa.String(length=64), nullable=True),
        sa.Column("edge_left", sa.String(length=64), nullable=True),
        sa.Column("edge_right", sa.String(length=64), nullable=True),
        sa.Column("geometry", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("source_file", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("thickness_source", sa.String(length=32), nullable=False),
        sa.Column("thickness_confidence", sa.Float(), nullable=False),
        sa.Column("material_source", sa.String(length=32), nullable=False),
        sa.Column("clarification", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("depth_overrides", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_parts_material_thickness", "parts", ["material_id", "thickness"])
    op.create_index("ix_parts_product", "parts", ["product_id"])
    op.create_index("ix_parts_status", "parts", ["status"])
    op.create_table(
        "sheets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("index", sa.Integer(), nullable=False),
        sa.Column("material_id", sa.Integer(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("is_offcut", sa.Boolean(), nullable=False),
        sa.Column("offcut_id", sa.Integer(), nullable=True),
        sa.Column("utilization", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["job_id"], ["nesting_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["offcut_id"], ["offcuts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sheets_job", "sheets", ["job_id"])
    op.create_table(
        "import_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("relpath", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("stored_path", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("detected_source", sa.String(length=32), nullable=False),
        sa.Column("raw_layers", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("resolve_trace", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("part_id", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["batch_id"], ["import_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["part_id"], ["parts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_import_files_batch", "import_files", ["batch_id"])
    op.create_table(
        "nc_programs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sheet_id", sa.Integer(), nullable=False),
        sa.Column("file", sa.Text(), nullable=False),
        sa.Column("tool_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("est_time", sa.Float(), nullable=True),
        sa.Column("post_id", sa.String(length=64), nullable=False),
        sa.Column("is_draft", sa.Boolean(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["sheet_id"], ["sheets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "part_instances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("part_id", sa.Integer(), nullable=False),
        sa.Column("uid", sa.String(length=64), nullable=False),
        sa.Column("sheet_id", sa.Integer(), nullable=True),
        sa.Column("x", sa.Float(), nullable=True),
        sa.Column("y", sa.Float(), nullable=True),
        sa.Column("rotation", sa.Float(), nullable=False),
        sa.Column("pinned", sa.Boolean(), nullable=False),
        sa.Column("pick_order", sa.Integer(), nullable=True),
        sa.Column("label_printed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["part_id"], ["parts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sheet_id"], ["sheets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uid", name="uq_part_instances_uid"),
    )
    op.create_index("ix_part_instances_sheet", "part_instances", ["sheet_id"])
    op.create_table(
        "spec_rows",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("match_key", sa.String(length=200), nullable=False),
        sa.Column("project_name", sa.String(length=200), nullable=True),
        sa.Column("product_name", sa.String(length=200), nullable=True),
        sa.Column("part_name", sa.String(length=200), nullable=True),
        sa.Column("code", sa.String(length=64), nullable=True),
        sa.Column("qty", sa.Integer(), nullable=True),
        sa.Column("length", sa.Float(), nullable=True),
        sa.Column("width", sa.Float(), nullable=True),
        sa.Column("thickness", sa.Float(), nullable=True),
        sa.Column("material_name", sa.String(length=200), nullable=True),
        sa.Column("grain", sa.String(length=16), nullable=True),
        sa.Column("edge_top", sa.String(length=64), nullable=True),
        sa.Column("edge_bottom", sa.String(length=64), nullable=True),
        sa.Column("edge_left", sa.String(length=64), nullable=True),
        sa.Column("edge_right", sa.String(length=64), nullable=True),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(["batch_id"], ["import_batches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "match_key", name="uq_spec_rows_batch_key"),
    )
    op.create_foreign_key("fk_offcuts_source_sheet_id", "offcuts", "sheets", ["source_sheet_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_offcuts_source_sheet_id", "offcuts", type_="foreignkey")
    op.drop_table("spec_rows")
    op.drop_index("ix_part_instances_sheet", table_name="part_instances")
    op.drop_table("part_instances")
    op.drop_table("nc_programs")
    op.drop_index("ix_import_files_batch", table_name="import_files")
    op.drop_table("import_files")
    op.drop_index("ix_sheets_job", table_name="sheets")
    op.drop_table("sheets")
    op.drop_index("ix_parts_material_thickness", table_name="parts")
    op.drop_index("ix_parts_product", table_name="parts")
    op.drop_index("ix_parts_status", table_name="parts")
    op.drop_table("parts")
    op.drop_table("import_batches")
    op.drop_table("products")
    op.drop_table("offcuts")
    op.drop_table("nesting_jobs")
    op.drop_table("material_sheet_formats")
    op.drop_table("tools")
    op.drop_table("projects")
    op.drop_table("materials")
    op.drop_table("layer_presets")
