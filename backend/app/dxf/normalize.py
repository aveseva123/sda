"""Чистка геометрии: сшивка разрывов, удаление дублей, замыкание контуров.

Нужна прежде всего для Fusion 360: он часто отдаёт контур несвязанными
сегментами вместо замкнутой полилинии и дублирует совпадающие линии.
Базис обычно отдаёт уже замкнутые полилинии, но конвейер общий.
"""

from __future__ import annotations

from collections import defaultdict

from app.dxf.model import Point

Chain = list[Point]


def _key(pt: Point, tol: float) -> tuple[int, int]:
    return (int(round(pt[0] / tol)), int(round(pt[1] / tol)))


def _neighbours(key: tuple[int, int]):
    kx, ky = key
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            yield (kx + dx, ky + dy)


def _near(a: Point, b: Point, tol: float) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def path_length(points: Chain) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:], strict=False):
        total += ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    return total


def canonical_signature(points: Chain, tol: float, closed: bool) -> tuple:
    """Ключ для поиска дублей: не зависит от направления обхода, а для
    замкнутых контуров — и от вершины, с которой начат обход."""
    quant = [_key(p, tol) for p in points]
    if closed and len(quant) > 1:
        if quant[0] == quant[-1]:
            quant = quant[:-1]
        if not quant:
            return ()
        start = min(range(len(quant)), key=lambda i: quant[i])
        rotated = quant[start:] + quant[:start]
        reverse = list(reversed(rotated))
        reverse = [reverse[-1]] + reverse[:-1]
        return tuple(min(rotated, reverse))
    return tuple(min(quant, list(reversed(quant))))


def deduplicate(chains: list[Chain], tol: float, closed_flags: list[bool]) -> list[Chain]:
    """Выбрасывает совпадающие сегменты и контуры."""
    seen: set[tuple] = set()
    out: list[Chain] = []
    for chain, closed in zip(chains, closed_flags, strict=True):
        sig = canonical_signature(chain, tol, closed)
        if not sig or sig in seen:
            continue
        seen.add(sig)
        out.append(chain)
    return out


def stitch(chains: list[Chain], tol: float) -> tuple[list[Chain], list[Chain]]:
    """Сшивает открытые цепочки в замкнутые контуры.

    Возвращает ``(замкнутые, оставшиеся открытыми)``. Открытые — это не
    ошибка сама по себе: паз и гравировка законно остаются открытыми.
    Для внешнего контура открытая цепочка означает незакрытый контур,
    и об этом сообщается технологу выше по стеку.
    """
    active: dict[int, Chain] = {}
    for idx, chain in enumerate(chains):
        if len(chain) >= 2:
            active[idx] = list(chain)

    # Индекс концов: квантованная точка → список (id цепочки, это_начало).
    ends: dict[tuple[int, int], list[tuple[int, bool]]] = defaultdict(list)

    def register(cid: int) -> None:
        chain = active[cid]
        ends[_key(chain[0], tol)].append((cid, True))
        ends[_key(chain[-1], tol)].append((cid, False))

    def unregister(cid: int) -> None:
        chain = active.get(cid)
        if chain is None:
            return
        for key, is_start in ((_key(chain[0], tol), True), (_key(chain[-1], tol), False)):
            bucket = ends.get(key)
            if bucket and (cid, is_start) in bucket:
                bucket.remove((cid, is_start))

    for cid in list(active):
        register(cid)

    closed: list[Chain] = []
    for cid in list(active):
        if cid not in active:
            continue
        chain = active[cid]
        if _near(chain[0], chain[-1], tol) and len(chain) >= 4:
            unregister(cid)
            del active[cid]
            closed.append(_close(chain))
            continue

        unregister(cid)
        del active[cid]
        # Наращиваем цепочку с конца, пока находится продолжение.
        while True:
            tail = chain[-1]
            match = _find_match(ends, active, tail, tol)
            if match is None:
                break
            other_id, other_is_start = match
            unregister(other_id)
            other = active.pop(other_id)
            chain.extend(other[1:] if other_is_start else list(reversed(other))[1:])
            if _near(chain[0], chain[-1], tol) and len(chain) >= 4:
                break

        if _near(chain[0], chain[-1], tol) and len(chain) >= 4:
            closed.append(_close(chain))
        else:
            # Не сомкнулась — возвращаем в пул как открытую.
            new_id = max(active, default=-1) + 1
            active[new_id] = chain
            register(new_id)
            # Больше не пытаемся её наращивать в этом проходе.
            unregister(new_id)

    return closed, list(active.values())


def _find_match(
    ends: dict[tuple[int, int], list[tuple[int, bool]]],
    active: dict[int, Chain],
    point: Point,
    tol: float,
) -> tuple[int, bool] | None:
    for key in _neighbours(_key(point, tol)):
        for cid, is_start in list(ends.get(key, ())):
            chain = active.get(cid)
            if chain is None:
                continue
            candidate = chain[0] if is_start else chain[-1]
            if _near(candidate, point, tol):
                return cid, is_start
    return None


def _close(chain: Chain) -> Chain:
    """Замыкает контур точно, подтягивая последнюю точку к первой."""
    out = list(chain)
    if out[0] != out[-1]:
        out.append(out[0])
    return out
