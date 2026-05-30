# OCR Targets

Known UI fixtures are 3840x1080 Lost Ark screenshots in English.

## Modes

### Applicant List

Fixture: `applicant-1.png`

Visible state:

- Find Party panel is open.
- `Other Party Recruitment Posts` is selected.
- Right panel has `Applicant` tab selected.
- Applicant cards contain character name, class icon/text context, item level, roster/combat metadata, and accept/reject buttons.

Primary OCR target:

- right-side applicant card character name, e.g. `Badseedrestart`.

Secondary context:

- selected encounter title, e.g. `[Normal]Dark Baratron`;
- lobby master/title row, e.g. `Pepegami`;
- gate/description line, e.g. `Gate 1 asdfasdf`.

### Other Party Selected Lobby

Visible state:

- `Other Party Recruitment Posts` is selected.
- Right panel has `Member` tab selected.
- Party 1 and Party 2 rows show existing party members.

Primary OCR targets:

- party member names in the right panel;
- selected lobby master name in the center list.

### Own Recruitment Lobby

Visible state:

- `My Party Recruitment Posts` is selected.
- The party layout appears along the bottom and the right member panel is visible.

Primary OCR targets:

- party member names in bottom slots;
- party member names in the right panel.

## Detection Strategy

The Find Party window can move. Avoid fixed screen coordinates.

Use a two-step crop strategy:

1. Detect the large Find Party panel from visual anchors:
   - title text near the top: `Find Party`;
   - gold/blue tab highlights;
   - vertical separator before the right details panel;
   - dark translucent panel bounds.
2. Crop OCR regions relative to the detected panel:
   - right panel title/encounter area;
   - tab row (`Member`, `Applicant`, `Party Search Settings`);
   - applicant card/list area;
   - selected lobby row in the center list;
   - party member rows.

Add a manual calibration fallback that lets the user drag rectangles for:

- encounter title;
- applicant list;
- member list;
- selected lobby row.

## OCR Output Rules

- Accept high-confidence character names automatically.
- Show low-confidence names inline for correction.
- Cache corrections keyed by raw OCR output.
- Dedupe exact names before log lookup.
- Treat Lost Ark OCR as English-only for v1.
