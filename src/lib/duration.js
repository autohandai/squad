/** Compact elapsed time with normalized units and no 60-second remainder. */
export function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1000) return `${Math.max(1, Math.round(value))} ms`;
  if (value < 10000) return `${(value / 1000).toFixed(1)} sec`;
  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours} hour${hours === 1 ? "" : "s"}${minutes ? ` ${minutes} min` : ""}`;
  if (minutes) return `${minutes} min${seconds ? ` ${seconds} sec` : ""}`;
  return `${seconds} sec`;
}
