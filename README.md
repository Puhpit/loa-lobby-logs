# LOA Lobby Logs

Personal Windows overlay for Lost Ark lobby/applicant screening.

The app will:

- read visible lobby/applicant character names from Lost Ark screenshots;
- fetch public lostark.bible logs for each detected character;
- prioritize the current encounter's logs;
- show percentile first, DPS second, and nDPS third in a compact overlay.

## Current Status

Checkpoint 1 set up the project and source-of-truth notes:

- `docs/lostark-bible-api.md` captures the HAR findings.
- `docs/ocr-targets.md` captures the known Lost Ark UI modes.
- `src/shared/types.ts` defines the initial app contracts.
- `src/main/lostarkBible.ts` sketches the provider that parses character page HTML and posts to `/api/character/logs`.

Checkpoint 2 hardened the lostark.bible parser with fixture-backed tests and CI.

Checkpoint 3 adds encounter-aware lobby summaries:

- visible Lost Ark encounter text is resolved to known lostark.bible boss groups;
- character names are deduped before lookup;
- fetched logs are summarized with current-encounter priority and per-character scrape failures.

## Local Fixtures

The current workspace contains:

- `applicant-1.png`: full-resolution applicant-list fixture.
- `lostark.bible.har`: captured lostark.bible character-log traffic.

These are local fixtures for development. Avoid committing HAR files with cookies or session headers.
