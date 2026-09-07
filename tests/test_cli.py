from pathlib import Path

import pytest

from cam import __version__
from cam.cli import main
from cam.core.paths import backup_dir, db_path


def test_version(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["version"]) == 0
    assert capsys.readouterr().out.strip() == __version__


def test_db_status_before_and_after_upgrade(
    data_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["--data-dir", str(data_dir), "db", "status"]) == 1
    assert main(["--data-dir", str(data_dir), "db", "upgrade"]) == 0
    assert db_path(data_dir).is_file()
    assert main(["--data-dir", str(data_dir), "db", "status"]) == 0
    out = capsys.readouterr().out
    assert "wal" in out and "соответствует ORM" in out


def test_db_backup(data_dir: Path) -> None:
    assert main(["--data-dir", str(data_dir), "db", "backup"]) == 1  # базы ещё нет
    assert main(["--data-dir", str(data_dir), "db", "upgrade"]) == 0
    assert main(["--data-dir", str(data_dir), "db", "backup"]) == 0
    assert len(list(backup_dir(data_dir).iterdir())) == 1


def test_env_var_selects_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "from_env"
    monkeypatch.setenv("CAM_DATA_DIR", str(target))
    assert main(["db", "upgrade"]) == 0
    assert db_path(target).is_file()
