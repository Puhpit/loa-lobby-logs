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

const KEY_ALIASES = new Map<string, string>([
  [" ", "Space"],
  ["space", "Space"],
  ["spacebar", "Space"],
  ["esc", "Escape"],
  ["escape", "Escape"],
  ["enter", "Enter"],
  ["return", "Enter"],
  ["tab", "Tab"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["del", "Delete"],
  ["insert", "Insert"],
  ["ins", "Insert"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["page up", "PageUp"],
  ["pagedown", "PageDown"],
  ["page down", "PageDown"],
  ["arrowup", "Up"],
  ["arrow up", "Up"],
  ["up", "Up"],
  ["arrowdown", "Down"],
  ["arrow down", "Down"],
  ["down", "Down"],
  ["arrowleft", "Left"],
  ["arrow left", "Left"],
  ["left", "Left"],
  ["arrowright", "Right"],
  ["arrow right", "Right"],
  ["right", "Right"],
  ["plus", "Plus"],
  ["+", "Plus"],
  ["minus", "-"],
  ["dash", "-"],
  ["period", "."],
  ["comma", ","],
  ["slash", "/"],
  ["backslash", "\\"],
  ["semicolon", ";"],
  ["quote", "'"],
  ["backquote", "`"],
  ["`", "`"],
  ["[", "["],
  ["]", "]"]
]);

export function normalizeHotkey(value: string | undefined): HotkeyConfig {
  const raw = value?.trim() || "Ctrl+Alt+D";
  const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
  const key = normalizeKey(parts.at(-1));
  const modifiers = parts.slice(0, -1).map((part) => MODIFIER_ALIASES.get(part.toLowerCase()) ?? part);
  const accelerator = [...modifiers, key].join("+");
  const userFacing = [...modifiers.map((modifier) => modifier === "Control" ? "Ctrl" : modifier), key].join("+");

  return { userFacing, accelerator };
}

function normalizeKey(value: string | undefined): string {
  const raw = value?.trim() || "D";
  const alias = KEY_ALIASES.get(raw.toLowerCase());
  if (alias) return alias;
  if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase();
  if (raw.length === 1) return raw.toUpperCase();
  return raw;
}
