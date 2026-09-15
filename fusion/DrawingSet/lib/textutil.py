"""Small text helpers shared by the Fusion modules (pure)."""
from __future__ import annotations

from typing import Iterable, Sequence


def table_text(header: Sequence[str], rows: Iterable[Sequence[str]]) -> str:
    """Monospace table for logs and reports."""
    rows = [list(map(str, r)) for r in rows]
    cols = len(header)
    widths = [len(h) for h in header]
    for r in rows:
        for i in range(min(cols, len(r))):
            widths[i] = max(widths[i], len(r[i]))
    fmt = "  ".join("{:<" + str(w) + "}" for w in widths)
    out = [fmt.format(*header), fmt.format(*["-" * w for w in widths])]
    for r in rows:
        r = (r + [""] * cols)[:cols]
        out.append(fmt.format(*r))
    return "\n".join(out)
