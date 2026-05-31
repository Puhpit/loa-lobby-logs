# LOA Lobby Logs

LOA Lobby Logs is a personal Windows overlay for Lost Ark lobby and applicant screening.

It captures the visible Lost Ark lobby/applicant UI, extracts character names with OCR, fetches public lostark.bible log data, and shows a compact overlay ranked by percentile, DPS, and nDPS.

## Usage

1. Install dependencies with `npm install`.
2. Start the app with `npm start`, or run the packaged portable executable.
3. Open settings from the tray icon.
4. With Lost Ark focused, press `Ctrl+Alt+D` to scan the visible lobby/applicant area.
5. Review the right-side overlay. Use the overlay close button to dismiss it.
6. Use the settings window for manual review/test scans when OCR is not the focus.

## Architecture

The app is an Electron + TypeScript desktop app with a main process, preload bridge, and shared renderer bundle.

Main process:

- `src/main/electron.ts` owns app startup, tray menu, settings and overlay windows, global hotkey registration, display capture, IPC handlers, diagnostics, and scan orchestration.
- `src/main/appPipeline.ts` combines OCR/manual candidates, encounter text, lostark.bible fetching, cache/rate-limit behavior, and lobby summaries.
- Settings, diagnostics, and cached summaries are stored under Electron `userData`.

Preload and renderer:

- `src/main/preload.cts` compiles to `dist/src/main/preload.cjs`. Electron windows load this CommonJS preload so `window.loaLobbyLogs` is exposed reliably.
- `src/renderer/renderer.ts` is one renderer bundle with `?view=settings` and `?view=overlay` modes.
- Renderer boot installs error handlers first, verifies preload availability, logs boot/click/render diagnostics, and shows a visible fatal message if the preload bridge is missing.

Data flow:

- The scan hotkey captures the display containing Lost Ark.
- OCR reads calibrated lobby/applicant/member regions into character candidates.
- The pipeline deduplicates candidates, resolves visible encounter text, fetches public lostark.bible logs, and builds overlay-ready summaries.
- The overlay renders rows from the latest scan result and can fall back to the last result when it initializes.
