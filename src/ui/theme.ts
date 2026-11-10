// Level colours: cool blue (1) → violet → magenta → hot pink (10). Amber is reserved for
// "queued / pending" (forced drop), red for recording (not used in this app).
export const levelHue = (level: number) => 215 + (Math.max(1, Math.min(10, level)) - 1) * 13.3;
export const levelColor = (level: number, l = 62, a = 1) => `hsla(${levelHue(level)}, 95%, ${l}%, ${a})`;
export const AMBER = "hsl(40, 100%, 58%)";
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
