"""Приём загруженных файлов: пачка, ZIP-архив, перетащенная папка."""

from __future__ import annotations

import hashlib
import zipfile
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path, PurePosixPath

from app.core.config_files import app_config

# Служебный мусор архиваторов и macOS.
_JUNK_PREFIXES = ("__MACOSX/", ".")
_JUNK_NAMES = {".DS_Store", "Thumbs.db"}


@dataclass(slots=True)
class IncomingFile:
    """Один файл на входе. ``relpath`` сохраняет структуру папок — из неё
    резолвер толщины берёт имя папки."""

    filename: str
    relpath: str
    data: bytes

    @property
    def suffix(self) -> str:
        return PurePosixPath(self.filename).suffix.lower()

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


@dataclass(slots=True)
class Unpacked:
    dxf: list[IncomingFile] = field(default_factory=list)
    spec: list[IncomingFile] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def _is_junk(name: str) -> bool:
    pure = PurePosixPath(name)
    if pure.name in _JUNK_NAMES:
        return True
    return any(name.startswith(prefix) for prefix in _JUNK_PREFIXES)


def unpack(files: list[IncomingFile]) -> Unpacked:
    """Разворачивает ZIP-архивы и раскладывает вход на DXF и спецификации."""
    allowed = {
        ext.lower()
        for ext in app_config().get("import", {}).get("allowed_extensions", [])
    }
    result = Unpacked()
    queue = list(files)

    while queue:
        item = queue.pop(0)
        if _is_junk(item.relpath):
            continue
        if item.suffix == ".zip":
            queue.extend(_expand_zip(item, result))
            continue
        if allowed and item.suffix not in allowed:
            result.skipped.append(f"{item.relpath}: расширение {item.suffix} не поддерживается")
            continue
        if item.suffix == ".dxf":
            result.dxf.append(item)
        elif item.suffix in {".csv", ".xlsx", ".xls", ".xml"}:
            result.spec.append(item)
        else:
            result.skipped.append(f"{item.relpath}: не DXF и не спецификация")

    return result


def _expand_zip(item: IncomingFile, result: Unpacked) -> list[IncomingFile]:
    out: list[IncomingFile] = []
    try:
        archive = zipfile.ZipFile(BytesIO(item.data))
    except zipfile.BadZipFile as exc:
        result.skipped.append(f"{item.relpath}: битый архив ({exc})")
        return out

    base = PurePosixPath(item.relpath).with_suffix("")
    for info in archive.infolist():
        if info.is_dir():
            continue
        name = info.filename.replace("\\", "/")
        if _is_junk(name):
            continue
        # Имена в архивах часто в cp866/cp1251 — ZipFile отдаёт их как есть,
        # приводим к читаемому виду, не ломая уже корректный UTF-8.
        name = _fix_zip_name(name, info.flag_bits)
        try:
            data = archive.read(info)
        except (RuntimeError, zipfile.BadZipFile) as exc:
            result.skipped.append(f"{name}: не удалось распаковать ({exc})")
            continue
        out.append(
            IncomingFile(
                filename=PurePosixPath(name).name,
                relpath=str(base / name),
                data=data,
            )
        )
    return out


def _fix_zip_name(name: str, flag_bits: int) -> str:
    # Бит 11 означает, что имя уже в UTF-8.
    if flag_bits & 0x800:
        return name
    try:
        return name.encode("cp437").decode("cp866")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name


def store(files: list[IncomingFile], target_dir: Path) -> dict[str, Path]:
    """Сохраняет файлы на диск, сохраняя структуру папок.

    Исходники нужны для повторного разбора после правки карты слоёв —
    без них пришлось бы просить заказчика загружать всё заново.
    """
    stored: dict[str, Path] = {}
    for item in files:
        # Защита от «../» в именах внутри архива.
        rel = PurePosixPath(item.relpath)
        safe_parts = [p for p in rel.parts if p not in ("..", "/", "")]
        path = target_dir.joinpath(*safe_parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(item.data)
        stored[item.relpath] = path
    return stored
