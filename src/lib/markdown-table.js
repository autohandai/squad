// GitHub-flavoured tables for the message renderer. Members answer with them
// constantly, and without a table case they arrive as a wall of pipes.
//
// Pure: no React, no DOM, so scripts/check-markdown-table.mjs can import it
// from Node.

/** `|---|:--:|` and friends. At least one dash per cell, nothing else. */
export function isTableSeparator(line) {
  const text = String(line ?? "").trim();
  if (!text.includes("-")) return false;
  const cells = splitTableRow(text);
  if (!cells.length) return false;
  return cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
}

/**
 * Cells of one row. Outer pipes are optional, `\|` is a literal pipe, and a
 * pipe inside a code span belongs to the code rather than the table.
 */
export function splitTableRow(line) {
  const text = String(line ?? "");
  if (!text.includes("|")) return [];
  const cells = [];
  let current = "";
  let inCode = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "`") inCode = !inCode;
    if (char === "|" && !inCode) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  // A leading or trailing pipe produces an empty cell at each end; drop those
  // rather than the empty cells a person actually wrote in the middle.
  if (cells.length && !cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
  return cells.map((cell) => cell.trim());
}

/**
 * A table starting at `index`, or null. Returns
 * `{ header, rows, next }` where `next` is the first line after the table.
 */
export function takeTable(lines, index = 0) {
  if (!Array.isArray(lines)) return null;
  const headerLine = lines[index];
  const separatorLine = lines[index + 1];
  if (typeof headerLine !== "string" || typeof separatorLine !== "string") return null;
  if (!headerLine.includes("|")) return null;
  if (isTableSeparator(headerLine)) return null;
  if (!isTableSeparator(separatorLine)) return null;

  const header = splitTableRow(headerLine);
  if (!header.length) return null;

  const rows = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (typeof line !== "string" || !line.trim() || !line.includes("|")) break;
    const cells = splitTableRow(line);
    // Pad a short row rather than dropping it: an uneven table still reads.
    while (cells.length < header.length) cells.push("");
    rows.push(cells);
    cursor += 1;
  }
  return { header, rows, next: cursor };
}
