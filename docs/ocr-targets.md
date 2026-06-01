# OCR Targets

Known UI fixtures are 3840x1080 Lost Ark screenshots in English. Local screenshot fixtures live under ignored `local/`.

## Calibrated Regions

The app currently uses manual calibration instead of visual anchor detection. Users must save two screenshot-pixel rectangles:

- `Encounter Title`: the selected encounter/lobby encounter title only.
- `Character List`: the visible right-side party/applicant character rows only.

Old single-rectangle calibration files are intentionally invalid. Recalibrate both required regions after upgrading from the old flow.

## UI Fixtures

### Applicant List

Fixture: `local/applicant-1.png`

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

## Future Detection Strategy

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

Manual calibration currently lets the user drag only the encounter title and character list rectangles.

## OCR Output Rules

- Accept high-confidence character names automatically.
- Filter exact normalized recruitment UI tokens and current Lost Ark world/server names before log lookup: `applicant`, `details`, `group`, `lobby`, `member`, `party`, `raid`, `rec`, `recr`, `recrui`, `recruit`, `recruiti`, `recruiting`, `selected`, `settings`, `view`, `arcturus`, `balthorr`, `brelshaza`, `elpon`, `gienah`, `inanna`, `luterra`, `luttera`, `nineveh`, `ortuus`, `ratik`, `thaemine`, and `vairgrys`.
- Do not filter difficulty or encounter words such as `first`, `hard`, `normal`, `nightmare`, `gate`, `kazeros`, `serca`, `armoche`, or `mordum`.
- Resolve encounter title OCR by tokenizing text, dropping standalone numeric noise, and matching known encounter aliases by ordered token coverage. Difficulty is detected from known difficulty tokens and does not require brackets.
- Dedupe exact names before log lookup.
- Treat Lost Ark OCR as English-only for v1.
