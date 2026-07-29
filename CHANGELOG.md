# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-07-29

### Added

- The event log now records the parsed HTTP response headers for every htmx request that runs over
  an XHR, and it captures `htmx:xhr:abort` events when a request is cancelled.

### Changed

- Migrated the package manager and build toolchain from npm to bun. The build script now installs
  dependencies with `bun install --frozen-lockfile` and runs the lint, CSS, and format steps through
  `bun run`.
- Updated the development dependencies to current releases, including Tailwind CSS v4 and ESLint 10.

## [1.0.6] - 2024-10-22

### Added

- HX attributes in target element details, snapshot information, and error handling and reporting,
  with reduced console log output.

## [1.0.5] - 2024-10-11

### Changed

- Captured before and after request and response events, removed the activeTab permission, and
  reduced console log output.

## [1.0.4] - 2024-10-03

### Fixed

- Excessive extension permissions flagged in a Google review.

## [1.0.3] - 2024-10-02

### Changed

- Added a Firefox release and fixed an HTML sanitization issue raised by Firefox review.

## [1.0.0] - 2024-09-30

### Added

- Initial release with the core debugging features and the Chrome Web Store launch.
