# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.2] - 2026-02-19

### Added

- Comprehensive `examples` directory with 4 distinct use cases (Basic, Hybrid, Redaction, Body-Aware).
- Support for `run.sh` (Bash) and `run.ps1` (PowerShell) scripts in examples for cross-platform ease.
- Structural graceful shutdown mechanism using `stdin` EOF for non-TTY processes.

### Fixed

- Unreliable `FINAL_STATS` emission on Windows by shifting to `stdin` EOF closure for graceful exit.
- Improved test runner stability by refining the `stopProcess` utility to wait for natural exit without forceful signals during graceful shutdown.

## [1.6.1] - 2026-02-19

### Added

- Full CLI management suite with the new `tape` command.
- Tape management subcommands: `list`, `inspect`, `clear`, `prune`.
- Advanced Match Strategies: `normalized` and `body-aware`.
- Response header and JSON body path redaction.
- Real-time and final metrics emission.

## [1.6.0] - 2026-02-18

### Added

- Redaction support for sensitive headers and JSON paths.
- Canonical JSON matching support.

## [1.5.0] - 2026-02-18

### Added

- Initial support for hybrid mode and record-on-miss logic.
