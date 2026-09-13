/* lib/coros.js reads COROS's querySportRecords answer, which is written for a
   language model rather than a program. This holds a sample of both shapes it
   comes in — numbered text (today) and JSON — and checks the week they add up
   to, including a run after midnight in Riyadh that is still Sunday in UTC.

     node tools/coros-test.js
*/

const assert = require("assert");

(async () => {
  const { parseRuns } = await import("../_worker.js/lib/coros.js");
  const { weekSummary } = await import("../_worker.js/lib/week.js");

  const ts = (iso) => Math.floor(Date.parse(iso) / 1000);
  const SUNDAY = "2026-09-13";

  const text = [
    "Found 3 activities:",
    "1. Run — 2026-09-13",
    "   LabelId: 111 | SportType: 100 | startTimestamp=" + ts("2026-09-13T06:00:00+03:00") + " endTimestamp=0",
    "   Distance: 5.02 km | Duration: 00:27:10",
    "2. Bike — 2026-09-14",
    "   LabelId: 222 | SportType: 200 | startTimestamp=" + ts("2026-09-14T06:00:00+03:00"),
    "   Distance: 20.1 km",
    "3. Track Run — 2026-09-14",
    "   LabelId: 333 | SportType: 103 | startTimestamp=" + ts("2026-09-14T01:00:00+03:00"),
    "   Distance: 800 m",
  ].join("\n");

  const fromText = parseRuns({ content: [{ type: "text", text: text }] });
  assert.strictEqual(fromText.length, 2, "the bike ride is not a run");
  const week = weekSummary(fromText, SUNDAY);
  assert.deepStrictEqual(week.days, [5020, 800, 0, 0, 0, 0, 0], "1am Monday in Riyadh is Monday");
  assert.strictEqual(week.total_m, 5820);

  const json = JSON.stringify({
    records: [{ labelId: 444, sportType: 101, startTimestamp: ts("2026-09-15T19:00:00+03:00"), distanceKm: 3 }],
  });
  const fromJson = parseRuns({ content: [{ type: "text", text: json }] });
  assert.deepStrictEqual(weekSummary(fromJson, SUNDAY).days, [0, 0, 3000, 0, 0, 0, 0], "JSON answers read too");

  assert.deepStrictEqual(parseRuns({ content: [{ type: "text", text: "No activities found." }] }), []);
  assert.deepStrictEqual(parseRuns(undefined), []);

  console.log("coros: parseRuns reads text and JSON, and the week lands on Riyadh days.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
