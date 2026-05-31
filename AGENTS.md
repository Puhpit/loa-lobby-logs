# AGENTS.md

## Project Overview

LOA Lobby Logs is a personal Windows Electron/TypeScript overlay for Lost Ark lobby and applicant screening.

The app reads visible lobby/applicant names from screenshots, fetches public lostark.bible character logs, prioritizes the current encounter, and displays compact ranking data such as percentile, DPS, and nDPS.

Current stack:

- Electron + TypeScript
- Node 24
- Vitest
- Tesseract.js OCR
- JSON file cache under Electron `userData`
- Electron Builder Windows portable packaging

Current runtime architecture:

- `src/main/electron.ts` owns the tray app, global scan hotkey, settings window, overlay window, display capture, IPC, and diagnostics.
- `src/main/preload.cts` builds to CommonJS `dist/src/main/preload.cjs`; Electron windows must load this `.cjs` preload so `window.loaLobbyLogs` is exposed.
- `src/renderer/renderer.ts` is one renderer bundle with `?view=settings` and `?view=overlay` modes. It guards missing preload with a visible fatal message and logs renderer boot/click/render events.
- `src/main/appPipeline.ts` combines OCR/manual candidates, encounter text, lostark.bible fetching, cache, rate limiting, and summaries.

## Primary Development Environment

Prefer Codex Desktop/local workspace for this repository.

Use the local environment for:

- Windows-specific behavior
- Electron app startup and packaging
- screenshot/OCR validation
- private fixtures
- HAR-derived development context
- visual overlay checks

Use Codex Cloud only when explicitly requested or when a Node/TypeScript task does not depend on local Windows behavior, private files, screenshots, HAR captures, or GUI validation.

Codex Cloud should not assume it has the same local fixtures or runtime context as Codex Desktop. Do not delegate to Codex Cloud unless the user explicitly asks or the task is isolated to tracked Node/TypeScript code with no local GUI, packaging, screenshot, HAR, or private fixture dependency.

## Local Context and Private Files

Important local-only context may exist in ignored files such as:

- CONTEXT.md
- local/
- local HAR captures
- local applicant screenshots
- local private fixtures
- local logs
- SQLite files
- generated caches

Read `CONTEXT.md` when available, but do not commit it.

Never commit raw HAR files, cookies, session headers, screenshots with private information, local databases, generated caches, or private fixtures.

If a task requires local-only files and they are unavailable, make a best effort using the tracked repository files and clearly note what could not be validated.

## Development Flow

Before editing:

1. Check git status.
2. Review relevant source, tests, docs, and local context notes if present.
3. Avoid unrelated refactors.

When changing code:

1. Keep changes focused.
2. Prefer small, reviewable commits.
3. Preserve existing public contracts unless the task requires changing them.
4. Add or update tests when behavior changes.
5. Update relevant docs when architecture, workflow, dependencies, configuration, or behavior changes.

## Validation

Use the strongest relevant checks available.

Common commands:

    npm test
    npm run typecheck
    npm run build
    npm start
    npm run package:win

Use Node 24 for local and CI validation. This workspace currently has Node/npm at:

    C:\Program Files\nodejs\node.exe
    C:\Program Files\nodejs\npm.cmd

Default validation order for most code changes:

1. npm test
2. npm run typecheck
3. npm run build

Use npm start for Electron runtime checks when local GUI validation is relevant.

Use `npm run package:win` only when packaging behavior or Windows distributable output is affected. Do not commit generated `dist/`, unpacked executables, `.tools/`, logs, screenshots, caches, or HAR files.

If local tooling is unavailable but GitHub Actions is configured, push a branch and use CI as the validation source, then inspect failures and iterate.

## Git and GitHub Workflow

For GitHub work, prefer a branch-and-PR workflow.

1. Create feature branches with the codex/ prefix unless asked otherwise.
2. Keep commits focused.
3. Do not bypass protected main.
4. Push branches and open draft PRs when work is ready for automated validation.
5. After merge, sync local main before continuing.

For this personal repo, keep review requirements lightweight unless asked otherwise.

## Documentation Maintenance

Tracked documentation should describe durable project behavior.

Local ignored notes should contain private working memory, fixture notes, HAR observations, temporary plans, and machine-specific setup details.

When making material repository changes, update the appropriate documentation before completing the task:

- Update tracked docs for durable, non-private project behavior.
- Update CONTEXT.md for private/local context when available.
- Do not duplicate README content unnecessarily.
- Skip documentation updates for trivial edits that do not affect behavior, architecture, dependencies, workflow, configuration, or developer expectations.

## Security and Privacy

Before pushing, check staged files for secrets and private data.

Pay special attention to:

- .har
- screenshots
- local/
- cookies/session headers
- tokens/API keys
- local logs
- SQLite files
- private fixtures
- generated OCR/cache files

Use .gitignore for project-wide ignores and .git/info/exclude for machine-local ignores that should not affect the repository.
