import type { AppSettings, ScanProgressStage } from "../shared/appTypes.js";

export function overlayBounds(
  workArea: { x: number; y: number; width: number; height: number },
  position: AppSettings["overlayPosition"],
  height = 760
): { x: number; y: number; width: number; height: number } {
  const width = 720;
  const clampedHeight = Math.min(height, workArea.height);
  const x = position === "right" ? workArea.x + workArea.width - width : workArea.x;
  return { x, y: workArea.y, width, height: clampedHeight };
}

export function overlayProgressHeight(stage: ScanProgressStage): number {
  return stage === "needs-calibration" || stage === "error" ? 178 : 96;
}

export function overlayResultHeight(summaryCount: number, warningCount = 0): number {
  const shellPadding = 20;
  const visibleSectionGaps = 21;
  const header = 38;
  const summary = 31;
  const tableHeader = 33;
  const rows = Math.max(1, summaryCount) * 78;
  const warnings = warningCount > 0 ? 7 + warningCount * 33 : 0;
  const scrollbarSafety = 18;
  return shellPadding + visibleSectionGaps + header + summary + tableHeader + rows + warnings + scrollbarSafety;
}
