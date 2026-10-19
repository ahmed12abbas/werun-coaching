/**
 * intervalsText() in js/model.js: a club speed session written as
 * Intervals.icu's workout text, which is what reaches Garmin/COROS as steps.
 *
 *   node tools/intervals-text-test.js
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const box = { TextEncoder, TextDecoder, btoa, atob, console, t: (k) => k, I18N: { lang: "en" } };
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/model.js"), "utf8"), box);
const { blankStep, encodeWorkout, decodeWorkout, intervalsText } = vm.runInContext(
  "({ blankStep, encodeWorkout, decodeWorkout, intervalsText })",
  box
);

const step = (type, fields) => Object.assign(blankStep(type), fields);
const w = {
  name: "Speed session",
  units: "km",
  blocks: [
    step("warmup", { durType: "open", estSeconds: 900, note: "15 min" }),
    step("rest", { durType: "open", note: "ABC drills + strides" }),
    { kind: "repeat", reps: 6, steps: [step("work", { meters: 400, note: "@10K" }), step("recovery", { durType: "time", seconds: 90, note: "jog" })] },
    { kind: "repeat", reps: 6, steps: [step("work", { meters: 200, note: "@5K" }), step("recovery", { durType: "time", seconds: 60, note: "jog" })] },
    step("cooldown", { durType: "open", estSeconds: 900, note: "15 min" }),
    step("work", { durType: "time", seconds: 300, target: { kind: "pace", fast: 240, slow: 255 } }),
  ],
};

// Through a share link and back, as the app does.
const got = intervalsText(decodeWorkout(encodeWorkout(w)));
const want = [
  "- 15 min 15m Press lap intensity=warmup",
  "- ABC drills + strides 1m Press lap intensity=rest",
  "",
  "6x",
  "- @10K 400mtr intensity=active",
  "- jog 1m30s intensity=recovery",
  "",
  "6x",
  "- @5K 200mtr intensity=active",
  "- jog 1m intensity=recovery",
  "",
  "- 15 min 15m Press lap intensity=cooldown",
  "- 5m 4:00/km-4:15/km Pace intensity=active",
].join("\n");
assert.strictEqual(got, want, "\n--- got ---\n" + got + "\n--- want ---\n" + want);
console.log("ok  intervalsText\n\n" + got);
