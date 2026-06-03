declare module "tesseract.js" {
  export function recognize(
    imagePath: string,
    language?: string,
    options?: Record<string, unknown>
  ): Promise<{ data: { text: string; confidence: number; words?: unknown[] } }>;
}
