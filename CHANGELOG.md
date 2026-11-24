# Changelog

## [0.3.0] - 2026-11-24

### Changed
- Renamed from `pi-jetbrains-transparent` to `pi-darkroom`. Themes are now `darkroom-dark` and `darkroom-classic`.
- The compact-row setting is saved in `~/.pi/agent/pi-darkroom.json`; an existing setting from the previous name is picked up automatically.

## [0.2.0] - 2026-11-24

### Added
- Diff cards for `edit`: syntax colors by file language, tinted added/removed lines, and emphasis on the changed part of single-line edits.
- Optional compact tool rows: `/command-colors compact on` shows successful Bash results as one line (`✓ 12 lines · 0.4s`). Expanded rows, running commands and failures stay in full. Off by default.

### Fixed
- Edit result rows no longer risk an empty card under the diff.

## [0.1.0] - 2026-11-23

- First release: JetBrains Dark and Darcula transparent themes, gray code cards, consistent shell-command colors, readable plain text, and red failure labels.
