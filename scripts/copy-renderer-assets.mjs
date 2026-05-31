import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/src/renderer", { recursive: true });
await cp("src/renderer/index.html", "dist/src/renderer/index.html");
await cp("src/renderer/styles.css", "dist/src/renderer/styles.css");
