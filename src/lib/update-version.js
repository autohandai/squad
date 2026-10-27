// Stable releases sort after their prereleases; unknown versions never retire a download.
export function compareUpdateVersions(left, right) {
  const parse = value => {
    const match = String(value || "").match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/);
    if (!match) return null;
    const pre = match[4]?.split(".") || [];
    if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
    return { core: match.slice(1, 4), pre };
  };
  const a = parse(left), b = parse(right);
  if (!a || !b) return null;
  const number = (x, y) => x.length !== y.length ? Math.sign(x.length - y.length) : x === y ? 0 : x < y ? -1 : 1;
  for (let i = 0; i < 3; i++) { const diff = number(a.core[i], b.core[i]); if (diff) return diff; }
  if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    return xn && yn ? number(x, y) : xn !== yn ? xn ? -1 : 1 : x < y ? -1 : 1;
  }
  return 0;
}

export function reconcileUpdateOperation(operation = {}, currentVersion = "") {
  const comparison = compareUpdateVersions(currentVersion, operation.version);
  if (comparison === null || comparison < 0) return operation;
  if (operation.phase === "complete" && operation.version === currentVersion && !operation.error && !operation.verified && !operation.installer && !operation.plan) return operation;
  return { ...operation, phase: "complete", version: currentVersion, verified: false, error: "", message: `Updated to ${currentVersion}.`, installer: undefined, plan: undefined, installMode: undefined };
}
