# lostark.bible API Notes

Source: `lostark.bible.har` captured from `https://lostark.bible/character/NA/Pepegami/logs`.

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
  udps: 501659099,
  ndps: 372845001,
  rdps: 405038937,
  buffs: [0.9866, 0.9957, 0.8295, 0.5937],
  class: "Sorceress",
  spec: "Igniter",
  gearScore: 1765,
  combatPower: 5385.51,
  percentile: 0.785,
  overallPercentile: 0.925,
  duration: 296830,
  timestamp: 1779941776795,
  isBus: false,
  isDead: false
}
```

## Encounter Groups

The route JS contains useful boss groups. Initial map:

```ts
{
  Serca: ["Corvus Tul Rak", "Witch of Agony, Serca"],
  Kazeros: ["Death Incarnate Kazeros", "Archdemon Kazeros", "Abyss Lord Kazeros"],
  Armoche: ["Brelshaza, Ember in the Ashes", "Armoche, Sentinel of the Abyss"],
  Tarkal: ["Flame of Darkness, Tarkal"],
  "Act 2: Brelshaza": ["Phantom Manifester Brelshaza", "Narok the Butcher"],
  Aegir: ["Aegir, the Oppressor", "Akkan, Lord of Death"],
  Behemoth: ["Behemoth, Cruel Storm Slayer", "Behemoth, the Storm Commander"],
  Echidna: ["Covetous Master Echidna", "Red Doom Narkiel"],
  Thaemine: [
    "Thaemine, Conqueror of Stars",
    "Thaemine the Lightqueller",
    "Valinak, Herald of the End",
    "Killineza the Dark Worshipper"
  ]
}
```

The visible Lost Ark encounter text should map to these groups where possible. Unknown encounter text falls back to recent logs.

## Implementation Notes

- Parse page HTML first; do not scrape rendered DOM for metadata.
- Use embedded page-1 logs immediately.
- Use `/api/character/logs` for page 2+ and filtered current-encounter fetches.
- Use a persistent Electron session if Cloudflare/session cookies are required.
- Do not commit HAR files containing cookies or session headers.
