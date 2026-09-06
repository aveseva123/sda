"""Пресеты раскроя.

Словарь параметров взят из ArtCAM, которым пользуется заказчик: начальная и
конечная глубина, припуск, точность, стратегия «смещение / растр», попутное
и встречное, начальная точка снаружи / внутри, плоскость безопасности,
точка возврата.

Разница с ArtCAM в том, что это НЕ диалог на каждую траекторию, а пресет на
материал: настроил раскрой ЛДСП 16 один раз, дальше он подбирается сам по
толщине и материалу. Задание хранит пресет, с которым было посчитано, —
старую УП можно повторить точь-в-точь.
"""

from __future__ import annotations

from sqlalchemy import Boolean, Float, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import JSONType, TimestampMixin


class CuttingPreset(Base, TimestampMixin):
    __tablename__ = "cutting_presets"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # По каким материалам подбирается автоматически.
    # {"thickness": 16.0, "material_regex": "(?i)лдсп", "include_offcuts": true}
    applies_to: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)

    # Группы параметров — ровно те, что видит технолог на экране пресета.
    placement: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    depth: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    strategy: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    # Фрезы по типам траекторий: ключ — тип операции, распознанный по геометрии.
    tools: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    # Порядок обработки: контур режется последним, иначе отрезанная деталь
    # поедет под фрезой.
    order: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    safety: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    post: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)

    # Последний посчитанный КИМ — показывается в карточке пресета.
    last_utilization: Mapped[float | None] = mapped_column(Float)

    __table_args__ = (UniqueConstraint("slug", name="uq_cutting_presets_slug"),)

    def thickness(self) -> float | None:
        value = (self.applies_to or {}).get("thickness")
        return float(value) if value is not None else None

    def tool_for(self, semantic: str, diameter: float | None = None) -> dict | None:
        """Фреза под тип операции. Для присадки выбирается по диаметру."""
        entry = (self.tools or {}).get(semantic)
        if entry is None:
            return None
        if isinstance(entry, dict):
            return entry
        if not isinstance(entry, list) or not entry:
            return None
        if diameter is None:
            return entry[0]
        return min(
            entry, key=lambda item: abs(float(item.get("diameter", 0.0)) - diameter)
        )
