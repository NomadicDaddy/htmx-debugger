# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.1] - 2026-07-30

### Fixed

- Pages that boost forms no longer flood the console with
  `DOMException: HTMLElement object could not be cloned`. A form control named `id`, `class`,
  or `attributes` shadows the matching property on the form element, so element details are
  now read through `Element.prototype` rather than off the element itself. This is the crash
  reported in issue #8.
- SVG elements no longer break event capture. Their `className` is an `SVGAnimatedString`
  instead of a string, and the class is now read from the attribute.
- An event that still fails to serialize is dropped with one console warning instead of being
  retried, counted toward the circuit breaker, and logged again on every occurrence.
- Element details are no longer reported as `[Circular]` when the same element appears twice
  in one event, which htmx does routinely with `detail.elt` and `detail.target`.

### Changed

- The content script no longer logs its startup and per-message progress to the console of
  every page it runs on. Warnings and errors are unchanged, and the "not connected to the
  background script" warning now appears once per disconnect rather than once per event.
- The htmx peer dependency range accepts the 4.0.0-beta6 prerelease.

### Removed

- Dropped the `htmx.process` wrapper and its synthetic `htmx:process` entry. Content scripts
  run in an isolated world and never see the page's `window.htmx`, so the wrapper never ran.
  htmx's own process events already report the same work, so the event log is unchanged.

## [1.2.0] - 2026-07-30

### Added

- The debugger now captures htmx 4's colon-separated lifecycle events while continuing to
  support htmx 2, including request and response filtering in the DevTools panel.

### Fixed

- Events emitted before the DevTools panel opens are kept in a bounded per-tab queue and shown
  when the panel connects.
- Reloading or updating the extension now stops invalidated content scripts cleanly instead of
  retrying and filling Chrome's extension error list.
- High-volume pages still apply the event limit without Chrome treating the expected rate limit
  as an extension error.

## [1.1.1] - 2026-07-29

### Fixed

- `bun run build` runs to completion again after the Tailwind v4 upgrade. The CSS build
  step pointed at the standalone Tailwind CLI, which no longer ships in v4; it now uses
  the dedicated `@tailwindcss/cli` package.
- The distribution build is reproducible from a clean checkout and can be re-run at the
  same version. It creates the `dist` directory before copying files, and rebuilding
  overwrites the existing release archives instead of erroring.
- The extension version shown in the browser now matches the package version. It had
  stayed at 1.0.6 since the 1.1.0 release because the manifest files were not bumped
  alongside `package.json`.

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
