// Small pure line diff (longest common subsequence). No React, no DOM, so
// scripts/check-canvases.mjs can import it from Node.
//
// diffLines(before, after) → [{ type: "equal" | "add" | "remove", text }]
// in document order: removed lines come before the added lines that replace
// them. Both inputs may be strings or arrays of lines.

function toLines(value) {
  if (Array.isArray(value)) return value.map((line) => String(line));
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffLines(before, after) {
  const a = toLines(before);
  const b = toLines(after);

  // Trim the common prefix and suffix so the LCS table only covers the
  // changed middle; large documents with one edit stay cheap.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const result = [];
  for (let index = 0; index < start; index += 1) result.push({ type: "equal", text: a[index] });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const rows = midA.length;
  const cols = midB.length;
  if (rows && cols) {
    // lcs[i][j] = length of the LCS of midA[i..] and midB[j..]
    const lcs = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (midA[i] === midB[j]) {
        result.push({ type: "equal", text: midA[i] });
        i += 1;
        j += 1;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        result.push({ type: "remove", text: midA[i] });
        i += 1;
      } else {
        result.push({ type: "add", text: midB[j] });
        j += 1;
      }
    }
    while (i < rows) result.push({ type: "remove", text: midA[i++] });
    while (j < cols) result.push({ type: "add", text: midB[j++] });
  } else {
    for (const line of midA) result.push({ type: "remove", text: line });
    for (const line of midB) result.push({ type: "add", text: line });
  }

  for (let index = endA; index < a.length; index += 1) result.push({ type: "equal", text: a[index] });
  return result;
}

/** Counts for a summary line: "+3 −1". */
export function diffStats(entries) {
  let added = 0;
  let removed = 0;
  for (const entry of entries) {
    if (entry.type === "add") added += 1;
    else if (entry.type === "remove") removed += 1;
  }
  return { added, removed, changed: added + removed > 0 };
}

/** Rebuild the "after" side from a diff; used by the check to prove correctness. */
export function applyDiff(entries) {
  return entries.filter((entry) => entry.type !== "remove").map((entry) => entry.text).join("\n");
}
