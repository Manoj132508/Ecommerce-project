"use strict";
// Local stand-in for fast-glob (MIGRATION_PLAN.md R35).
//
// @next/eslint-plugin-next uses fast-glob in one place: getRootDirs() expands
// the optional `settings.next.rootDir` glob (monorepos), calling
// globSync(pattern, { onlyDirectories: true }). The real package pulls in
// micromatch -> braces <= 3.0.3, which has an unpatched DoS advisory
// (GHSA-vfj7-8cjw-p6xm). Node's built-in fs.globSync covers this use without
// that dependency chain. package.json "overrides" maps fast-glob here for that
// plugin only; nothing else in the app uses it.
const fs = require("node:fs");
const path = require("node:path");

function globSync(pattern, options = {}) {
  if (typeof fs.globSync !== "function") {
    throw new Error("fast-glob shim: Node.js 22 or newer is required (fs.globSync).");
  }
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const matches = patterns.flatMap((entry) => fs.globSync(entry, { cwd: options.cwd ?? process.cwd() }));
  const filtered = options.onlyDirectories
    ? matches.filter((match) => {
        try {
          return fs.statSync(path.resolve(options.cwd ?? process.cwd(), match)).isDirectory();
        } catch {
          return false;
        }
      })
    : matches;
  return [...new Set(filtered)].map((match) => match.split(path.sep).join("/")).sort();
}

module.exports = { globSync, sync: globSync };
