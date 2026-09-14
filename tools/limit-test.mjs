// The rate limiter against a real SQLite, shaped like D1: the cap holds, a
// second key is counted apart, and a missing table lets the request through.
//   node tools/limit-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tooOften } from "../_worker.js/lib/limit.js";

function d1(sqlite) {
  return {
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        run: async () => sqlite.prepare(sql).run(...args),
      }),
    }),
  };
}

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../migrations/0026_rate_limits.sql", import.meta.url), "utf8"));
const db = d1(sqlite);

for (let i = 0; i < 3; i++) assert.equal(await tooOften(db, "su", "1.2.3.4", 3, 3600), false, "try " + (i + 1));
assert.equal(await tooOften(db, "su", "1.2.3.4", 3, 3600), true, "fourth is refused");
assert.equal(await tooOften(db, "su", "5.6.7.8", 3, 3600), false, "another address has its own count");
assert.equal(await tooOften(db, "li", "1.2.3.4", 3, 3600), false, "another scope has its own count");
assert.equal(await tooOften(db, "su", "", 3, 3600), false, "nobody to count");
assert.equal(await tooOften(null, "su", "1.2.3.4", 3, 3600), false, "no database");
assert.equal(await tooOften(d1(new DatabaseSync(":memory:")), "su", "1.2.3.4", 3, 3600), false, "no table yet");
console.log("limit-test: ok");
