import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const root = process.cwd();
const localDir = join(root, "local");
const answersPath = join(localDir, "answers.txt");
const calibrationPath = join(process.env.APPDATA ?? "", "loa-lobby-logs", "calibration.json");
const ocrModulePath = join(root, "dist", "src", "main", "ocrCharacterSource.js");
const outputDir = join(localDir, "debug-ocr-eval");

const CALIBRATION_REFERENCE_SIZE = { width: 3420, height: 1410 };
const DEFAULT_CHARACTER_ZONE = { x: 1290, y: 190, width: 500, height: 470 };
const DEFAULT_ENCOUNTER_ZONE = { x: 1450, y: 135, width: 250, height: 45 };

if (!existsSync(answersPath)) {
  throw new Error(`Missing local answers file: ${answersPath}`);
}
if (!existsSync(ocrModulePath)) {
  throw new Error("Build first with npm run build so dist/src/main/ocrCharacterSource.js exists.");
}

const { ScreenshotCharacterSource, detectVisualCardsFromImage, detectVisualLayoutFromImage } = await import(pathToFileURL(ocrModulePath).href);
const expectedByImage = parseAnswers(await readFile(answersPath, "utf8"));
const savedCalibration = await readSavedCalibration();
const results = [];
await mkdir(outputDir, { recursive: true });

for (const [imageName, expectedNames] of expectedByImage) {
  const imagePath = join(localDir, `${imageName}.png`);
  if (!existsSync(imagePath)) {
    results.push({ imageName, error: "missing-image", expectedNames, actualNames: [] });
    continue;
  }
  const metadata = await sharp(imagePath).metadata();
  const imageSize = { width: metadata.width ?? CALIBRATION_REFERENCE_SIZE.width, height: metadata.height ?? CALIBRATION_REFERENCE_SIZE.height };
  const characterZone = scaledRect(savedCalibration?.characterList ?? DEFAULT_CHARACTER_ZONE, imageSize);
  const encounterZone = scaledRect(savedCalibration?.encounterTitle ?? DEFAULT_ENCOUNTER_ZONE, imageSize);

  const source = new ScreenshotCharacterSource({
    imagePath,
    calibration: {
      version: 1,
      encounterTitle: encounterZone,
      characterList: characterZone
    },
    sourceMode: "character-list"
  });
  const actualNames = (await source.getVisibleApplicants()).map((candidate) => candidate.normalizedName);
  const cards = await detectVisualCardsFromImage(imagePath, characterZone).catch(() => []);
  const layoutType = await detectVisualLayoutFromImage(imagePath, characterZone).catch(() => "unknown");
  results.push({
    imageName,
    expectedNames,
    actualNames,
    layoutType,
    characterZone,
    cards,
    missing: expectedNames.filter((name) => !hasName(actualNames, name)),
    extra: actualNames.filter((name) => !hasName(expectedNames, name))
  });
  await saveOverlay(imagePath, imageName, characterZone, cards, actualNames, expectedNames, layoutType);
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
await writeFile(join(outputDir, "summary.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");

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

async function readSavedCalibration() {
  if (!calibrationPath || !existsSync(calibrationPath)) return undefined;
  try {
    return JSON.parse(await readFile(calibrationPath, "utf8"));
  } catch {
    return undefined;
  }
}

function scaledRect(rect, imageSize) {
  const xScale = imageSize.width / CALIBRATION_REFERENCE_SIZE.width;
  const yScale = imageSize.height / CALIBRATION_REFERENCE_SIZE.height;
  return {
    x: Math.max(0, Math.round(rect.x * xScale)),
    y: Math.max(0, Math.round(rect.y * yScale)),
    width: Math.max(1, Math.round(rect.width * xScale)),
    height: Math.max(1, Math.round(rect.height * yScale))
  };
}

async function saveOverlay(imagePath, imageName, zone, cards, actualNames, expectedNames, layoutType) {
  const metadata = await sharp(imagePath).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  ${rect(zone, "red", 3)}
  ${cards.map((card) => [
    rect(card.rect, "#22c55e", 2),
    card.iconRect ? rect(card.iconRect, "#38bdf8", 2) : "",
    rect(card.nameRect, "#facc15", 2),
    card.serverRect ? rect(card.serverRect, "#a78bfa", 1) : "",
    card.statusRect ? rect(card.statusRect, "#fb7185", 1) : ""
  ].join("")).join("")}
  <rect x="12" y="12" width="${Math.min(width - 24, 860)}" height="74" fill="rgba(0,0,0,0.72)" />
  <text x="20" y="34" fill="white" font-family="Consolas, monospace" font-size="18">${escapeSvg(imageName)} (${escapeSvg(layoutType)})</text>
  <text x="20" y="56" fill="#bbf7d0" font-family="Consolas, monospace" font-size="14">actual: ${escapeSvg(actualNames.join(", ") || "(none)")}</text>
  <text x="20" y="76" fill="#fecaca" font-family="Consolas, monospace" font-size="14">expected: ${escapeSvg(expectedNames.join(", ") || "(none)")}</text>
</svg>`;

  await sharp(imagePath)
    .composite([{ input: Buffer.from(svg), blend: "over" }])
    .png()
    .toFile(join(outputDir, `${imageName}-overlay.png`));
}

function rect(value, stroke, width) {
  return `<rect x="${value.x}" y="${value.y}" width="${value.width}" height="${value.height}" fill="none" stroke="${stroke}" stroke-width="${width}" />`;
}

function escapeSvg(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
