import { defaultAppearance, type Appearance } from "./hub-types";
export const themes = [
  { id: "forest", name: "Herb garden", color: "#173e32" },
  { id: "ocean", name: "Blue skies", color: "#1d526a" },
  { id: "sunset", name: "Peachy days", color: "#7d3c30" },
  { id: "berry", name: "Berry bright", color: "#613578" },
  { id: "midnight", name: "After hours", color: "#28354b" },
  { id: "sand", name: "Warm sand", color: "#715034" },
  { id: "mint", name: "Fresh mint", color: "#246052" },
  { id: "rose", name: "Wild rose", color: "#8b3755" },
] as const;
export const fonts = [
  { id: "friendly", name: "Nunito · friendly & rounded" },
  { id: "simple", name: "DM Sans · simple & clear" },
  { id: "editorial", name: "Newsreader · prep notebook" },
  { id: "playful", name: "Fredoka · playful headings" },
  { id: "bookish", name: "Lora · storybook headings" },
  { id: "accessible", name: "Atkinson · easy to read" },
] as const;
export const backgrounds = [
  { id: "plain", name: "Plain paper" },
  { id: "confetti", name: "Little confetti" },
  { id: "waves", name: "Gentle waves" },
  { id: "dots", name: "Polka dots" },
  { id: "grid", name: "Notebook grid" },
  { id: "stars", name: "Starlight" },
  { id: "gradient", name: "Soft gradient" },
];
export function normalizedAppearance(value?: Appearance): Required<Appearance> {
  const p = { ...defaultAppearance, ...value };
  return {
    ...p,
    textSize: p.textSize ?? (p.largeText ? "large" : "standard"),
    spacing: p.spacing ?? "comfortable",
    cardStyle: p.cardStyle ?? "soft",
    photoOverlay: p.photoOverlay ?? 88,
    highContrast: p.highContrast ?? false,
    dashboardSummaries: p.dashboardSummaries ?? true,
    timeFormat: p.timeFormat ?? "system",
    startPage: p.startPage ?? "today",
  };
}
export function applyAppearance(value: Appearance) {
  const p = normalizedAppearance(value),
    root = document.documentElement;
  Object.assign(root.dataset, {
    theme: p.theme,
    font: p.font,
    background: p.background.startsWith("photo:") ? "photo" : p.background,
    large: String(p.largeText),
    textSize: p.textSize,
    spacing: p.spacing,
    cardStyle: p.cardStyle,
    contrast: p.highContrast ? "high" : "normal",
    summaries: p.dashboardSummaries ? "on" : "off",
    clock: p.timeFormat,
    motion: p.reduceMotion ? "reduced" : "normal",
  });
  const opacity = p.photoOverlay / 100,
    rgb = p.theme === "midnight" ? "16,28,42" : "255,255,255";
  document.body.style.backgroundImage = p.background.startsWith("photo:")
    ? `linear-gradient(rgba(${rgb},${opacity}),rgba(${rgb},${opacity})),url("/api/hub/photos/${p.background.slice(6)}")`
    : "";
}
export function resetAppearance() {
  applyAppearance(defaultAppearance);
}
export function displayTime(at: string | number) {
  const format =
    typeof document === "undefined"
      ? "system"
      : document.documentElement.dataset.clock;
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(format === "12h"
      ? { hour12: true }
      : format === "24h"
        ? { hour12: false }
        : {}),
  });
}

export function clockOptions(): Intl.DateTimeFormatOptions {
  const mode =
    typeof document === "undefined"
      ? "system"
      : document.documentElement.dataset.clock;
  return mode === "12h"
    ? { hour12: true }
    : mode === "24h"
      ? { hour12: false }
      : {};
}
export function displayDateTime(
  at: string | number,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Date(at).toLocaleString(undefined, {
    ...options,
    ...clockOptions(),
  });
}
