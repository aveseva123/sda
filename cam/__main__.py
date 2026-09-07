"""``python -m cam`` / ``cam`` — запуск графического интерфейса."""

from __future__ import annotations

import sys


def main() -> None:
    from cam.ui.app import run

    sys.exit(run())


if __name__ == "__main__":
    main()
