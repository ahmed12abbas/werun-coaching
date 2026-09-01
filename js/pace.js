"use strict";

/* =========================================================================
   WE RUN Coaching — the club's pace chart, as a calculator.

   The numbers are the coach's own chart, not a formula: rows are a best mile
   time, columns are the paces that follow from it. Everything in here is
   seconds per kilometre — the per-mile view is only a display conversion.

   Between two printed rows the answer is interpolated, so a 7:12 mile gets
   its own numbers instead of being rounded onto 7:00 or 7:30.
   ========================================================================= */

/* mile | 5K | 10K | Tempo | HM | Marathon | Recovery  — paces are min/km */
// prettier-ignore
const PACE_PRINTED = [
  ["5:00",  "3:25", "3:34", "3:46", "3:43", "3:53", "4:20"],
  ["5:30",  "3:43", "3:53", "4:05", "4:00", "4:14", "4:42"],
  ["6:00",  "4:02", "4:11", "4:25", "4:30", "4:36", "5:04"],
  ["6:30",  "4:25", "4:33", "4:45", "4:42", "4:58", "5:26"],
  ["7:00",  "4:45", "4:55", "5:07", "5:10", "5:20", "5:47"],
  ["7:30",  "5:01", "5:13", "5:30", "5:26", "5:41", "6:09"],
  ["8:00",  "5:25", "5:35", "5:51", "5:54", "6:03", "6:31"],
  ["8:30",  "5:41", "5:54", "6:09", "6:09", "6:22", "6:50"],
  ["9:00",  "6:00", "6:12", "6:31", "6:37", "6:43", "7:11"],
  ["9:30",  "6:22", "6:34", "6:50", "6:55", "7:05", "7:33"],
  ["10:00", "6:37", "6:53", "7:11", "7:18", "7:27", "7:55"],
  ["10:30", "7:00", "7:11", "7:27", "7:33", "7:50", "8:17"],
  ["11:00", "7:14", "7:27", "7:50", "8:01", "8:04", "8:32"],
  ["11:30", "7:36", "7:50", "8:04", "8:13", "8:20", "8:45"],
  ["12:00", "7:52", "8:07", "8:26", "8:45", "8:57", "9:10"],
].map((r) => ({ mile: parseClock(r[0]), paces: r.slice(1).map(parseClock) }));

// Column order is the chart's own, left to right.
const PACE_KEYS = ["pc5k", "pc10k", "pcTempo", "pcHm", "pcMar", "pcRec"];

// Where the coach's printed numbers actually stop. Rows outside this are ours,
// not theirs, and the card says so.
const PACE_PRINTED_RANGE = [PACE_PRINTED[0].mile, PACE_PRINTED[PACE_PRINTED.length - 1].mile];

/**
 * The printed chart runs 5:00 to 12:00 for the mile — a 17:05 to 39:20 5 K —
 * which leaves out both the front of the club and everyone still working up to
 * their first hour. This carries each column on past either end at the average
 * gradient it holds across the printed rows, anchored on the end row so the
 * extension joins it without a step. The printed rows themselves are never
 * touched.
 */
function extendChart(printed, fromMile, toMile, step) {
  const first = printed[0];
  const last = printed[printed.length - 1];
  const slope = first.paces.map((v, i) => (last.paces[i] - v) / (last.mile - first.mile));

  // Recovery climbs more gently across the printed rows than marathon does, so
  // carried far enough the two swap over and the chart starts claiming an easy
  // run is harder than race pace. Columns are printed fastest to slowest, so
  // holding each slope to at least the one before it keeps that order however
  // far the extension runs. Only recovery is actually raised by this.
  for (let i = 1; i < slope.length; i++) slope[i] = Math.max(slope[i], slope[i - 1]);

  const carry = (row, mile) => ({
    mile: mile,
    paces: row.paces.map((v, i) => v + slope[i] * (mile - row.mile)),
  });

  const out = [];
  for (let m = fromMile; m < first.mile; m += step) out.push(carry(first, m));
  out.push.apply(out, printed);
  for (let m = last.mile + step; m <= toMile; m += step) out.push(carry(last, m));
  return out;
}

// 4:00 to 20:00 for the mile covers a 16:00 5 K at one end and an hour at the
// other, with room to spare either side of what the rollers offer.
const PACE_CHART = extendChart(PACE_PRINTED, 4 * 60, 20 * 60, 30);

const PACE_RANGE = {
  mile: [PACE_CHART[0].mile, PACE_CHART[PACE_CHART.length - 1].mile],
  // The 5 K column read as a finishing time, which is how athletes quote it.
  k5: [PACE_CHART[0].paces[0] * 5, PACE_CHART[PACE_CHART.length - 1].paces[0] * 5],
};

const clampNum = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Index of the row to interpolate from, given a value in a sorted column. */
function paceRowIndex(value, of) {
  let i = 0;
  while (i < PACE_CHART.length - 2 && of(PACE_CHART[i + 1]) < value) i++;
  return i;
}

/**
 * Every pace for a mile time, in seconds per km. Times off either end of the
 * chart are pulled back onto it rather than extrapolated — the chart stops
 * where the coach stopped trusting it.
 */
function pacesForMile(mileSeconds) {
  const mile = clampNum(mileSeconds, PACE_RANGE.mile[0], PACE_RANGE.mile[1]);
  const i = paceRowIndex(mile, (r) => r.mile);
  const a = PACE_CHART[i];
  const b = PACE_CHART[i + 1];
  const f = (mile - a.mile) / (b.mile - a.mile);
  return {
    mile: mile,
    clamped: Math.abs(mile - mileSeconds) > 0.5,
    // Past where the coach's chart is printed, so these are carried on from it
    // rather than read off it.
    extended: mile < PACE_PRINTED_RANGE[0] || mile > PACE_PRINTED_RANGE[1],
    paces: a.paces.map((v, j) => v + (b.paces[j] - v) * f),
  };
}

/** The same chart read backwards: a 5 K finishing time -> the mile it implies. */
function mileForFiveK(totalSeconds) {
  const total = clampNum(totalSeconds, PACE_RANGE.k5[0], PACE_RANGE.k5[1]);
  const perKm = total / 5;
  const i = paceRowIndex(perKm, (r) => r.paces[0]);
  const a = PACE_CHART[i];
  const b = PACE_CHART[i + 1];
  const f = (perKm - a.paces[0]) / (b.paces[0] - a.paces[0]);
  return {
    mile: a.mile + (b.mile - a.mile) * f,
    clamped: Math.abs(total - totalSeconds) > 0.5,
  };
}

/** Chart paces are per km; the card follows whatever units the session uses. */
const paceInUnits = (secPerKm, units) => (units === "mi" ? secPerKm * (METERS.mi / 1000) : secPerKm);

/* ---------- the little runner --------------------------------------------
   Nobody gets a slug or a snail: the ladder tops out at an F1 car and bottoms
   out at a runner, which is what everyone reading this actually is. Only the
   speed of the track really carries the meaning.
   ------------------------------------------------------------------------- */

// [5 K time this rung stops at, the glyphs, which way they are drawn]
//
// Keyed on the 5 K, because that is the time the club quotes at each other. The
// racing pair carries everything from 25 minutes on, which is most of the
// group; the ladder above it is for the sharp end.
//
// Emoji are drawn in profile facing left — the car, the animals and the runners
// alike, on Apple and on Segoe. -1 means "mirror this to face forwards", which
// is every glyph in the ladder today; the field stays because it is the one
// thing about these that cannot be worked out from the page, and the day a
// right-facing glyph joins the list it will need it.
// prettier-ignore
const PACE_SPRITES = [
  [19 * 60, ["\u{1F3CE}️"], -1], // under a 19:00 5 K — F1 car
  [21 * 60, ["\u{1F406}"], -1],            // cheetah
  [23 * 60, ["\u{1F40E}"], -1],            // horse
  [25 * 60, ["\u{1F407}"], -1],            // rabbit
  // From 25 minutes on it is a pair, racing each other down the track.
  [Infinity, ["\u{1F3C3}‍♂️", "\u{1F3C3}‍♀️"], -1],
];

function spriteFor(fiveKSeconds) {
  for (const s of PACE_SPRITES) if (fiveKSeconds < s[0]) return s;
  return PACE_SPRITES[PACE_SPRITES.length - 1];
}

/**
 * 0 at the fast end of the printed chart, 1 at the slow end — the extended rows
 * pin to whichever end they ran off, so the track keeps the spread it was tuned
 * to instead of stretching it over an hour-long 5 K.
 */
const paceEffort = (mileSeconds) =>
  clampNum(
    (mileSeconds - PACE_PRINTED_RANGE[0]) / (PACE_PRINTED_RANGE[1] - PACE_PRINTED_RANGE[0]),
    0,
    1
  );

/* ---------- the roller ----------------------------------------------------
   A scroll-snapping column, which is the one picker that works the same with
   a thumb, a wheel and the arrow keys. The snap points are real scroll
   positions, so the phone does the physics.
   ------------------------------------------------------------------------- */

const ROLL_ITEM = 44; // must match .roll li in index.html

const rollRange = (lo, hi) => {
  const out = [];
  for (let v = lo; v <= hi; v++) out.push(v);
  return out;
};

function rollerColumn(values, label, onPick) {
  const items = values.map((v) => el("li", {}, pad2(v)));
  const col = el(
    "div",
    {
      class: "roll",
      role: "spinbutton",
      tabindex: "0",
      "aria-label": label,
      "aria-valuemin": String(values[0]),
      "aria-valuemax": String(values[values.length - 1]),
    },
    el("ul", {}, items)
  );

  let index = 0;
  let settle = null;

  function publish() {
    items.forEach((li, i) => li.classList.toggle("on", i === index));
    col.setAttribute("aria-valuenow", String(values[index]));
    col.setAttribute("aria-valuetext", pad2(values[index]));
  }

  function setIndex(i) {
    const next = clampNum(i, 0, values.length - 1);
    const moved = next !== index;
    index = next;
    col.scrollTop = index * ROLL_ITEM;
    publish();
    return moved;
  }

  // Scrolls we caused ourselves come back through here too. They settle on the
  // value that is already set, and the caller drops those — which is a lot
  // safer than a flag that has to be cleared, since anything that stopped it
  // being cleared would wedge the column for good.
  col.addEventListener("scroll", () => {
    const i = clampNum(Math.round(col.scrollTop / ROLL_ITEM), 0, values.length - 1);
    if (i !== index) {
      index = i;
      publish();
    }
    // Fires once the flick has come to rest, not on every frame of it.
    clearTimeout(settle);
    settle = setTimeout(onPick, 90);
  });

  col.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    if (setIndex(index + step)) onPick();
  });

  publish();
  return {
    node: col,
    value: () => values[index],
    // scrollTop only takes while the column is laid out, so this is called
    // again whenever the panel is opened.
    set: (v) => setIndex(Math.max(0, values.indexOf(v))),
  };
}

/* ---------- the card ------------------------------------------------------ */

const PACE_KEY = "werun.pace";
// Whole minutes on the roller. The two ranges are the same span of running seen
// from either end — a 16:00 5 K is about a 4:40 mile, an hour is about 18:30 —
// so switching between them lands somewhere the other roller can actually hold.
const PACE_ROLL = { mile: [4, 19], k5: [16, 60] };
const PACE_DEFAULT = { mile: 8 * 60, k5: 25 * 60 };

const clampToMode = (seconds, mode) =>
  Math.round(clampNum(seconds, PACE_ROLL[mode][0] * 60, PACE_ROLL[mode][1] * 60 + 59));

function loadPaceEntry() {
  try {
    const saved = JSON.parse(localStorage.getItem(PACE_KEY) || "null");
    if (!saved || (saved.mode !== "mile" && saved.mode !== "k5")) return null;
    // Entries written before the roller held "mm:ss" rather than seconds.
    const secs = typeof saved.value === "string" ? parseClock(saved.value) : saved.value;
    if (!secs || secs <= 0) return null;
    return { mode: saved.mode, value: clampToMode(secs, saved.mode) };
  } catch (e) {
    return null;
  }
}

function savePaceEntry(mode, value) {
  try {
    localStorage.setItem(PACE_KEY, JSON.stringify({ mode: mode, value: value }));
  } catch (e) {}
}

/**
 * The pace calculator that sits beside the session title.
 *
 * Returns the toggle button and the panel it opens; the caller places them.
 * An athlete who has used it before finds it already open with their own
 * numbers in it, because that is the only reason they come back to it.
 */
function paceCalculator(units) {
  const saved = loadPaceEntry();
  let mode = saved ? saved.mode : "mile";
  let value = saved ? saved.value : PACE_DEFAULT[mode];
  let cols = null;
  let boostTimer = null;

  const label = el("label", {});
  const rollerBox = el("div", {});
  const results = el("div", {});
  const hint = el("p", { class: "small muted" });

  const spriteBox = el("div", { class: "track-sprite" });
  let spriteKey = ""; // rebuilding the nodes would restart the bob mid-stride
  const track = el(
    "div",
    { class: "track", "aria-hidden": "true" },
    el("div", { class: "track-road" }),
    // The runner layer drifts up and back the track; the sprite bobs inside it
    // and the speed lines ride along behind, so the three never come apart.
    el(
      "div",
      { class: "track-runner" },
      el(
        "div",
        { class: "track-lines" },
        el("i", { style: "top:0;width:17px" }),
        el("i", { style: "top:6px;width:11px;animation-delay:.12s" }),
        el("i", { style: "top:12px;width:14px;animation-delay:.06s" })
      ),
      spriteBox
    )
  );

  const modes = ["mile", "k5"];
  const modeBtns = modes.map((id) =>
    el(
      "button",
      {
        type: "button",
        "aria-pressed": mode === id ? "true" : "false",
        onclick: () => {
          if (mode === id) return;
          // Carry the effort across rather than resetting: the chart already
          // knows what this mile is worth over 5 K, and the other way round.
          value = clampToMode(
            mode === "mile" ? pacesForMile(value).paces[0] * 5 : mileForFiveK(value).mile,
            id
          );
          mode = id;
          savePaceEntry(mode, value);
          buildRoller();
          draw(true);
        },
      },
      id === "mile" ? t("pcMile") : t("pcFiveK")
    )
  );

  const cell = (key, secPerKm) =>
    el(
      "div",
      { class: "pace-cell" },
      el("div", { class: "k" }, t(key)),
      el("div", { class: "v mono" }, fmtClock(paceInUnits(secPerKm, units))),
      el("div", { class: "u" }, "/ " + unitLabel(units))
    );

  function buildRoller() {
    const picked = () => {
      const next = clampToMode(cols.min.value() * 60 + cols.sec.value(), mode);
      if (next === value) return; // a scroll that settled where it already was
      value = next;
      savePaceEntry(mode, value);
      draw(true);
    };
    cols = {
      min: rollerColumn(rollRange(PACE_ROLL[mode][0], PACE_ROLL[mode][1]), t("pcMinutes"), picked),
      sec: rollerColumn(rollRange(0, 59), t("pcSeconds"), picked),
    };
    rollerBox.textContent = "";
    rollerBox.append(
      el(
        "div",
        { class: "roller" },
        cols.min.node,
        el("div", { class: "roll-sep" }, ":"),
        cols.sec.node
      )
    );
    sync();
  }

  /** Put the columns back where the value says. A no-op while hidden. */
  function sync() {
    if (!cols) return;
    cols.min.set(Math.floor(value / 60));
    cols.sec.set(value % 60);
  }

  function draw(boost) {
    modeBtns.forEach((b, i) => b.setAttribute("aria-pressed", modes[i] === mode ? "true" : "false"));
    label.textContent = mode === "mile" ? t("pcMileLabel") : t("pcFiveKLabel");

    const back = mode === "k5" ? mileForFiveK(value) : null;
    const row = pacesForMile(back ? back.mile : value);

    results.textContent = "";
    const grid = el("div", { class: "pace-grid" });
    row.paces.forEach((p, i) => grid.append(cell(PACE_KEYS[i], p)));
    results.append(grid);

    // The other half of the pair, so the athlete can sanity-check the answer
    // against a race they have actually run.
    hint.textContent =
      (row.extended ? t("pcExtended") + " " : "") +
      (mode === "mile"
        ? t("pcThatIs5k", { time: fmtClock(row.paces[0] * 5) })
        : t("pcThatIsMile", { time: fmtClock(row.mile) }));

    // The track carries the meaning: quicker chart row, quicker everything.
    const effort = paceEffort(row.mile);
    track.style.setProperty("--road", (0.26 + effort * 0.66).toFixed(2) + "s");
    track.style.setProperty("--bob", (0.2 + effort * 0.3).toFixed(2) + "s");
    track.style.setProperty("--drift", (0.9 + effort * 1.3).toFixed(2) + "s");
    // Off the drift's own period, so the two never fall into step.
    track.style.setProperty("--jostle", (1.35 + effort * 0.9).toFixed(2) + "s");

    const look = spriteFor(row.paces[0] * 5);
    const key = look[1].join("");
    if (key !== spriteKey) {
      spriteKey = key;
      spriteBox.textContent = "";
      // .runner carries the jostle, the span inside it carries the bob — two
      // transforms that would otherwise fight over the same element.
      for (const glyph of look[1]) {
        spriteBox.append(el("span", { class: "runner" }, el("span", {}, glyph)));
      }
    }
    spriteBox.style.setProperty("--face", String(look[2]));
    if (boost) {
      track.classList.add("boost");
      clearTimeout(boostTimer);
      boostTimer = setTimeout(() => track.classList.remove("boost"), 420);
    }
  }

  const panel = el(
    "div",
    { class: "pacebox stack" },
    el("div", { class: "seg" }, modeBtns),
    el("div", {}, label, rollerBox),
    track,
    results,
    hint,
    el("p", { class: "small muted" }, t("pcFoot"))
  );

  buildRoller();
  draw(false);

  // Always folded away on open. The session is what the link is for, and the
  // calculator is a detour off it — their saved time is still in the roller
  // waiting for them, it just doesn't push the session down the page to say so.
  let open = false;
  panel.classList.add("hidden");

  const button = el(
    "button",
    {
      class: "btn sm pace-toggle",
      "aria-expanded": open ? "true" : "false",
      onclick: () => {
        open = !open;
        panel.classList.toggle("hidden", !open);
        button.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) sync();
      },
    },
    // The glow chases round the rim while the panel is shut, to say there is
    // something here worth opening. It stops once you have opened it.
    el("span", { class: "pace-glow", "aria-hidden": "true" }),
    el("span", { class: "pace-face" }, el("span", { html: ICON.timer }), t("pcOpen"))
  );

  return { button: button, panel: panel };
}
