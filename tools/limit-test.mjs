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
assert.equal(await tooOften(d1(new DatabaseSync(":memory:")), "su", "4.4.4.4", 3, 3600), false, "no table yet");
assert.equal(await tooOften(d1(new DatabaseSync(":memory:")), "pwd", "4.4.4.4", 10, 60, true), true, "a password guard fails closed");

// Once over, the next knock is refused without touching the database.
let writes = 0;
const counted = { prepare: (sql) => { writes++; return db.prepare(sql); } };
for (let i = 0; i < 3; i++) await tooOften(counted, "ci", "9.9.9.9", 2, 3600);
const before = writes;
assert.equal(await tooOften(counted, "ci", "9.9.9.9", 2, 3600), true, "still refused");
assert.equal(writes, before, "…and it cost no write");
console.log("limit-test: ok");
