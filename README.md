# LOA Lobby Logs

LOA Lobby Logs is a personal Windows overlay for Lost Ark lobby and applicant screening.

It captures the visible Lost Ark lobby/applicant UI, extracts character names with OCR, fetches public lostark.bible log data, and shows a compact overlay with role-aware percentile, performance, and nDPS/uDPS data.

## Usage

1. Install dependencies with `npm install`.
2. Start the app with `npm start`, or run the packaged portable executable.
3. Open settings from the tray icon.
4. Use the two calibration buttons in settings to drag separate boxes over the live Lost Ark display for the encounter title and visible character rows. The app blocks scans until both regions are saved.
5. With Lost Ark focused, press `Ctrl+Alt+D` to scan the visible lobby/applicant area.
6. Review the overlay. It opens immediately with scan progress, then updates with results when OCR and public log lookups finish. It defaults to the left side and can be moved to the right side from settings. Use the overlay close button to dismiss it.
7. Use the settings footer to save settings or open app diagnostics logs.

## Architecture

The app is an Electron + TypeScript desktop app with a main process, preload bridge, and shared renderer bundle.

Main process:

- `src/main/electron.ts` owns app startup, tray menu, settings and overlay windows, global hotkey registration, display capture, IPC handlers, diagnostics, and scan orchestration.
- `src/main/appPipeline.ts` combines OCR/manual candidates, encounter text, lostark.bible fetching, cache/rate-limit behavior, and lobby summaries.
- Settings, calibration, diagnostics, and cached lostark.bible responses are stored under Electron `userData`.

Preload and renderer:

- `src/main/preload.cts` compiles to `dist/src/main/preload.cjs`. Electron windows load this CommonJS preload so `window.loaLobbyLogs` is exposed reliably.
- `src/renderer/renderer.ts` is one renderer bundle with `?view=settings`, `?view=overlay`, and `?view=calibration` modes.
- Renderer boot installs error handlers first, verifies preload availability, logs boot/click/render diagnostics, and shows a visible fatal message if the preload bridge is missing.

Data flow:

- The scan hotkey opens the overlay first. If calibration is missing, the overlay shows a setup warning and blocks the scan.
- OCR reads the calibrated encounter title region into encounter text and the calibrated character list region into character candidates. Calibration rectangles are saved in screenshot pixel coordinates after the user drags each live screen region.
- The pipeline deduplicates candidates, resolves visible encounter text, fetches public lostark.bible logs, and builds overlay-ready summaries.
- The overlay renders live scan progress and rows from the current scan event only. Full scan results are not persisted; closing the overlay clears the visible renderer state while the lostark.bible response cache remains available for later scans.
