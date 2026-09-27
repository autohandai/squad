#!/usr/bin/env node
// Members answer with GitHub-flavoured tables constantly. Until now the
// renderer had no table case, so every one of them landed as a wall of pipes.
// These are the rules for recognising and splitting one.

import assert from "node:assert/strict";

import { isTableSeparator, splitTableRow, takeTable } from "../src/lib/markdown-table.js";

// --- separator recognition -------------------------------------------------

for (const good of ["|---|---|", "| --- | --- |", "|:--|--:|", "| :---: | ---- |", "---|---"]) {
  assert.equal(isTableSeparator(good), true, `${good} is a separator`);
}
for (const bad of ["| a | b |", "---", "", "| -- x -- |", "|:|", "text"]) {
  assert.equal(isTableSeparator(bad), false, `${bad} is not a separator`);
}

// --- row splitting ---------------------------------------------------------

assert.deepEqual(splitTableRow("| a | b |"), ["a", "b"], "outer pipes are trimmed");
assert.deepEqual(splitTableRow("a | b"), ["a", "b"], "outer pipes are optional");
assert.deepEqual(splitTableRow("| a |  | c |"), ["a", "", "c"], "an empty cell is kept");
assert.deepEqual(splitTableRow("| a \\| b | c |"), ["a | b", "c"], "an escaped pipe stays in the cell");
assert.deepEqual(splitTableRow("|  `x|y`  | c |"), ["`x|y`", "c"], "a pipe inside code is not a separator");

// --- taking a table off the front -----------------------------------------

{
  const lines = ["| Project | Stack |", "|---|---|", "| code | Bun |", "| api | Hono |", "", "after"];
  const table = takeTable(lines, 0);
  assert.ok(table, "a header plus separator plus rows is a table");
  assert.deepEqual(table.header, ["Project", "Stack"]);
  assert.deepEqual(table.rows, [["code", "Bun"], ["api", "Hono"]]);
  assert.equal(table.next, 4, "it stops at the blank line");
}

{
  // The table the user actually hit: many columns, cells containing code.
  const lines = [
    "| Project | Stack | Tests | CI/CD | Docs |",
    "|---|---|---|---|---|",
    "| `code/` | Bun workspaces | Bun test | ci.yml | docs/ |",
  ];
  const table = takeTable(lines, 0);
  assert.equal(table.header.length, 5);
  assert.deepEqual(table.rows[0][0], "`code/`");
  assert.equal(table.next, 3, "it consumes to the end of the input");
}

{
  // A row with fewer cells than the header is padded, not dropped.
  const lines = ["| a | b | c |", "|---|---|---|", "| 1 | 2 |"];
  const table = takeTable(lines, 0);
  assert.deepEqual(table.rows[0], ["1", "2", ""], "short rows are padded to the header width");
}

{
  // A row with more cells than the header keeps them: dropping content is worse
  // than an uneven table.
  const lines = ["| a | b |", "|---|---|", "| 1 | 2 | 3 |"];
  const table = takeTable(lines, 0);
  assert.deepEqual(table.rows[0], ["1", "2", "3"]);
}

// --- what is not a table ---------------------------------------------------

assert.equal(takeTable(["| a | b |", "| c | d |"], 0), null, "no separator means no table");
assert.equal(takeTable(["plain text", "|---|---|"], 1), null, "a separator alone is not a table");
assert.equal(takeTable(["| a | b |", "|---|---|"], 0)?.rows.length, 0, "a header with no body is still a table");
assert.equal(takeTable([], 0), null, "no lines, no table");
assert.equal(takeTable(["text"], 0), null, "prose is not a table");

// --- hostile input ---------------------------------------------------------

for (const bad of [null, undefined, "string", 42, {}]) {
  assert.equal(takeTable(bad, 0), null, `${JSON.stringify(bad)} is not a table`);
  assert.equal(isTableSeparator(bad), false);
  assert.deepEqual(splitTableRow(bad), [], "splitting nothing gives nothing");
}

console.log("check-markdown-table: ok");
