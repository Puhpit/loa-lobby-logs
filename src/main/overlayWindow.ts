import type { AppSettings } from "../shared/appTypes.js";

export function overlayBounds(
  workArea: { x: number; y: number; width: number; height: number },
  position: AppSettings["overlayPosition"]
): { x: number; y: number; width: number; height: number } {
  const width = 720;
  const height = Math.min(760, workArea.height);
  const x = position === "right" ? workArea.x + workArea.width - width : workArea.x;
  return { x, y: workArea.y, width, height };
}
