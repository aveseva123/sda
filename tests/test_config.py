from pathlib import Path

import pytest

from cam.core.config import AppDefaults, ConfigError, defaults_path, load_defaults


def test_bundled_defaults_load_and_are_sane() -> None:
    cfg = load_defaults()
    assert isinstance(cfg, AppDefaults)
    assert cfg.geometry.min_segment_length_mm < cfg.geometry.stitch_tolerance_mm
    assert cfg.storage.backups_keep >= 1
    assert cfg.ui.font_point_size >= 6


def test_defaults_file_lives_in_resources() -> None:
    assert defaults_path().is_file()
    assert defaults_path().parent.name == "resources"


def test_unknown_key_is_rejected(tmp_path: Path) -> None:
    text = defaults_path().read_text(encoding="utf-8") + "\nunknown_section:\n  a: 1\n"
    bad = tmp_path / "defaults.yaml"
    bad.write_text(text, encoding="utf-8")
    with pytest.raises(ConfigError, match="unknown_section"):
        load_defaults(bad)


def test_negative_tolerance_is_rejected(tmp_path: Path) -> None:
    text = (
        defaults_path()
        .read_text(encoding="utf-8")
        .replace("chord_tolerance_mm: 0.01", "chord_tolerance_mm: -0.01")
    )
    bad = tmp_path / "defaults.yaml"
    bad.write_text(text, encoding="utf-8")
    with pytest.raises(ConfigError, match="chord_tolerance_mm"):
        load_defaults(bad)


def test_missing_file_is_a_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        load_defaults(tmp_path / "nope.yaml")


def test_non_mapping_root_is_rejected(tmp_path: Path) -> None:
    bad = tmp_path / "defaults.yaml"
    bad.write_text("- just\n- a list\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="словарь"):
        load_defaults(bad)
