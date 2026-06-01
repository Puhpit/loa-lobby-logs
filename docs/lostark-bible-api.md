# lostark.bible API Notes

Source: ignored local HAR capture `local/lostark.bible.har` captured from `https://lostark.bible/character/NA/Pepegami/logs`.

## Character Page

Request:

```text
GET https://lostark.bible/character/{region}/{characterName}/logs
```

The initial HTML embeds SvelteKit boot data. The useful character header fields are present in the page, so the app does not need a separate metadata endpoint.

Observed header shape:

```ts
{
  id: 22864512,
  sn: "200000000063884",
  rid: 219368,
  ilvl: 1765,
  class: "elemental_master",
  world: "Brelshaza"
}
```

The first page of logs is also embedded in the initial page data as `logs`.

## Logs Endpoint

Request:

```text
POST https://lostark.bible/api/character/logs
Content-Type: application/json
```

Payload:

```ts
{
  region: "NA",
  characterSerial: "200000000063884",
  className: "Sorceress",
  cid: 22864512,
  rid: 219368,
  bosses?: string[],
  page: 1
}
```

The route JS constructs this from:

```ts
{
  region: params.region,
  characterSerial: data.header.sn,
  className: classMap[data.header.class],
  cid: data.header.id,
  rid: data.header.rid,
  bosses,
  page
}
```

## Log Entry Fields

Observed log entries include:

```ts
{
  id: "WoJ4yYf",
  name: "Pepegami",
  boss: "Armoche, Sentinel of the Abyss",
  difficulty: "Hard",
  dps: 837519948,
  bdps: undefined,
  udps: 501659099,
  ndps: 372845001,
  rdps: 405038937,
  rContribution: undefined,
  buffs: [0.9866, 0.9957, 0.8295, 0.5937],
  class: "Sorceress",
  spec: "Igniter",
  gearScore: 1765,
  combatPower: 5385.51,
  percentile: 0.785,
  contributionPercentile: undefined,
  overallPercentile: 0.925,
  duration: 296830,
  timestamp: 1779941776795,
  isBus: false,
  isDead: false
}
```

Support log rows use the same log endpoint, but the site switches display semantics when `spec` is one of:

```ts
["Desperate Salvation", "Full Bloom", "Blessed Aura", "Liberator"]
```

For support rows, lostark.bible displays `contributionPercentile` and `percentile` as two badges, displays the four `buffs` values as AP / Brand / Identity / T percentages, and displays `rContribution` as an `r` contribution percentage. For DPS rows, it displays `percentile`, `dps`, and `ndps`, with `udps` only as a fallback.

Decoded site source color thresholds:

```ts
// Uses Math.floor(percentile * 100)
100: { text: "#dcc999", background: "#e5cc80" }
99:  { text: "#FF69B4", background: "#ee59a5" }
95+: { text: "#FFA441", background: "#ff8000" }
75+: { text: "#ce84ff", background: "#a75ed5" }
50+: { text: "#0096ff", background: "#0096ff" }
25+: { text: "#3dd351", background: "#3dd351" }
else:{ text: "#afafaf", background: "#6a6a6a" }
```

Support performance text colors are AP red, Brand green, Identity yellow, and T blue.

## Encounter Groups

The app intentionally supports only the in-game labels currently needed by the overlay. The supported lostark.bible boss groups are:

```ts
{
  Serca: ["Corvus Tul Rak", "Witch of Agony, Serca"],
  Kazeros: ["Death Incarnate Kazeros", "Archdemon Kazeros", "Abyss Lord Kazeros"],
  Mordum: ["Mordum, the Abyssal Punisher", "Flash of Punishment", "Blossoming Fear, Naitreya", "Infernas"],
  Armoche: ["Brelshaza, Ember in the Ashes", "Armoche, Sentinel of the Abyss"]
}
```

Unknown encounter text falls back to recent logs.

Observed in-game lobby labels are aliases for encounter groups, not gates:

```ts
{
  "Mount Antares": "Mordum",
  "Fortress of Destruction": "Armoche",
  "Final Day": "Kazeros",
  "Sanctum of Frost": "Serca"
}
```

Bracketed lobby labels such as `[Normal]`, `[Hard]`, `[Nightmare]`, and `[The First]` are difficulty labels. The lobby does not expose the gate, so the app filters by encounter group and difficulty, then displays the latest matching log while exposing recent matching logs in the overlay details.

HAR captures did not show an explicit in-game alias map. Character-log filters use boss-group arrays. Ranking requests encode both boss and difficulty; for example, captured Kazeros ranking requests paired `Death Incarnate Kazeros` with `The First`, which supports treating `[The First] Final Day` as Kazeros filtered to `The First` difficulty.

`local/lostark.bible.5.har` confirmed the official lostark.bible Mordum group as `Mordum, the Abyssal Punisher`, `Flash of Punishment`, `Blossoming Fear, Naitreya`, and `Infernas`.

Overlay gate chips are display-only labels for known boss names. They are manually maintained from user-verified encounter labels rather than derived from the lostark.bible log API:

```ts
{
  "Witch of Agony, Serca": "G1",
  "Corvus Tul Rak": "G2",
  "Abyss Lord Kazeros": "G1",
  "Death Incarnate Kazeros": "G2",
  "Brelshaza, Ember in the Ashes": "G1",
  "Armoche, Sentinel of the Abyss": "G2",
  "Infernas": "G1",
  "Blossoming Fear, Naitreya": "G2",
  "Flash of Punishment": "G3"
}
```

## Search Endpoint

The home-page search bar uses a SvelteKit remote endpoint:

```text
GET https://lostark.bible/_app/remote/ngsbie/search?payload={base64url-json}
```

Observed payload shape for `name=Freak`, `region=NA`:

```json
[["__skrao",1],{"name":2,"region":3},"Freak","NA"]
```

The response envelope contains a JSON string in `result`. The app treats this endpoint as best-effort because the remote ID may change. It is used only after direct character lookup fails, and only for conservative same-length accent/confusable recovery.

Observed result records are encoded as flattened triples after reference arrays:

```json
[[1],[2,3,4],"Iamboneofmysword","hawk_eye",1795]
```

The parser extracts `{ name, classKey, itemLevel }` records. Search item level is useful diagnostic/future matching metadata, but OCR item level is not reliable enough to use as a character matching rule yet.

Direct page requests can return HTTP 200 with an unparseable or missing embedded header for OCR-confused names. Treat that as recoverable and run search fallback before failing.

Recovery is conservative:

- same character count only;
- accent-fold differences are allowed;
- a small confusable set is allowed: `I/l/1`, `O/0`, `S/5`, `B/8`;
- if more than one same-length confusable candidate matches, the lookup fails safely instead of guessing.

## Implementation Notes

- Parse page HTML first; do not scrape rendered DOM for metadata.
- Use embedded page-1 logs immediately.
- Use `/api/character/logs` for page 2+ and filtered current-encounter fetches.
- Use a persistent Electron session if Cloudflare/session cookies are required.
- Do not commit HAR files containing cookies or session headers.
