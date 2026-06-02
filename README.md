# LOA Lobby Logs

LOA Lobby Logs is a personal Windows overlay for Lost Ark lobby and applicant screening.

It captures the visible Lost Ark lobby/applicant UI, extracts character names with OCR, fetches public lostark.bible log data, and shows a compact overlay with role-aware percentile, performance, and nDPS/uDPS data.

## Usage

1. Install dependencies with `npm install`.
2. Start the app with `npm start`, or run the packaged portable executable.
3. Configure the app from the tray icon. Settings is where you choose the region, capture the scan hotkey, choose left/right overlay placement, calibrate OCR zones, save settings, and open diagnostics logs.
4. Set both OCR zones before scanning:
   - Encounter Title: drag a box around the lobby encounter title text, such as the bracketed difficulty and raid name.
   - Character List: drag a box around the visible lobby/applicant/member character rows.
   The app blocks scans until both zones are saved. Settings shows the saved coordinates for each zone.
5. Configure the scan hotkey by clicking the hotkey field, pressing the desired key combination, then pressing Save Settings. The hotkey is not persisted until settings are saved. The current default is `Ctrl+Alt+D`.
6. With Lost Ark focused and the configured lobby visible, press the scan hotkey or use Scan Now from the tray/settings window.
7. Review the overlay. It opens immediately with scan progress, then updates with current-scan results when OCR and public lostark.bible lookups finish. Rows show class/spec, ilvl, combat power, the selected encounter gate, role-aware percentiles, performance, and nDPS/uDPS or support rDPS data. If a character exists but has no public logs, the row still shows known character metadata with a no-public-logs message.
8. Dismiss the overlay with its close button. Full scan results are not persisted after the overlay is cleared, but lostark.bible responses remain cached under Electron `userData`.

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
- OCR reads the calibrated Encounter Title zone into encounter text and the calibrated Character List zone into character candidates. Calibration rectangles are saved in screenshot pixel coordinates after the user drags each live screen region.
- The pipeline deduplicates candidates, resolves visible encounter text, fetches public lostark.bible logs, and builds overlay-ready summaries.
- The overlay renders live scan progress and rows from the current scan event only. Full scan results are not persisted; closing the overlay clears the visible renderer state while the lostark.bible response cache remains available for later scans.
