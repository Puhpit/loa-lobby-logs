export interface HotkeyConfig {
  userFacing: string;
  accelerator: string;
}

const MODIFIER_ALIASES = new Map<string, string>([
  ["ctrl", "Control"],
  ["control", "Control"],
  ["cmdorctrl", "CommandOrControl"],
  ["commandorcontrol", "CommandOrControl"],
  ["cmd", "Command"],
  ["command", "Command"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["shift", "Shift"]
]);

export function normalizeHotkey(value: string | undefined): HotkeyConfig {
  const raw = value?.trim() || "Ctrl+Alt+D";
  const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.at(-1)?.toUpperCase() || "D";
  const modifiers = parts.slice(0, -1).map((part) => MODIFIER_ALIASES.get(part.toLowerCase()) ?? part);
  const accelerator = [...modifiers, key].join("+");
  const userFacing = [...modifiers.map((modifier) => modifier === "Control" ? "Ctrl" : modifier), key].join("+");

  return { userFacing, accelerator };
}
