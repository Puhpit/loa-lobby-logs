import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const localDir = join(root, "local");
const answersPath = join(localDir, "answers.txt");
const ocrModulePath = join(root, "dist", "src", "main", "ocrCharacterSource.js");

const DEFAULT_CHARACTER_ZONE = { x: 1290, y: 190, width: 500, height: 470 };
const DEFAULT_ENCOUNTER_ZONE = { x: 1450, y: 135, width: 250, height: 45 };

if (!existsSync(answersPath)) {
  throw new Error(`Missing local answers file: ${answersPath}`);
}
if (!existsSync(ocrModulePath)) {
  throw new Error("Build first with npm run build so dist/src/main/ocrCharacterSource.js exists.");
}

const { ScreenshotCharacterSource } = await import(pathToFileURL(ocrModulePath).href);
const expectedByImage = parseAnswers(await readFile(answersPath, "utf8"));
const results = [];

for (const [imageName, expectedNames] of expectedByImage) {
  const imagePath = join(localDir, `${imageName}.png`);
  if (!existsSync(imagePath)) {
    results.push({ imageName, error: "missing-image", expectedNames, actualNames: [] });
    continue;
  }

  const source = new ScreenshotCharacterSource({
    imagePath,
    calibration: {
      version: 1,
      encounterTitle: DEFAULT_ENCOUNTER_ZONE,
      characterList: DEFAULT_CHARACTER_ZONE
    },
    sourceMode: "character-list"
  });
  const actualNames = (await source.getVisibleApplicants()).map((candidate) => candidate.normalizedName);
  results.push({
    imageName,
    expectedNames,
    actualNames,
    missing: expectedNames.filter((name) => !hasName(actualNames, name)),
    extra: actualNames.filter((name) => !hasName(expectedNames, name))
  });
}

for (const result of results) {
  console.log(`\n${result.imageName}`);
  if (result.error) {
    console.log(`  error: ${result.error}`);
    continue;
  }
  console.log(`  expected: ${result.expectedNames.join(", ") || "(none)"}`);
  console.log(`  actual:   ${result.actualNames.join(", ") || "(none)"}`);
  console.log(`  missing:  ${result.missing.join(", ") || "(none)"}`);
  console.log(`  extra:    ${result.extra.join(", ") || "(none)"}`);
}

const expectedTotal = results.reduce((sum, result) => sum + result.expectedNames.length, 0);
const missingTotal = results.reduce((sum, result) => sum + (result.missing?.length ?? result.expectedNames.length), 0);
const extraTotal = results.reduce((sum, result) => sum + (result.extra?.length ?? 0), 0);
console.log(`\nsummary: ${expectedTotal - missingTotal}/${expectedTotal} expected found, ${missingTotal} missing, ${extraTotal} extra`);

function parseAnswers(text) {
  const entries = new Map();
  let current;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const header = trimmed.match(/^([^:]+):$/);
    if (header) {
      current = header[1];
      entries.set(current, []);
      continue;
    }
    if (!current) continue;
    const name = nameFromLostArkBibleUrl(trimmed);
    if (name) entries.get(current).push(name);
  }

  return entries;
}

function nameFromLostArkBibleUrl(value) {
  const match = value.match(/\/character\/[^/]+\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function hasName(names, expected) {
  const foldedExpected = fold(expected);
  return names.some((name) => fold(name) === foldedExpected);
}

function fold(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}
