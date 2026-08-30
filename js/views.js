"use strict";

/* =========================================================================
   WE RUN Coaching — the athlete-facing viewer and the coach-facing builder.
   ========================================================================= */

/* ===================== shared pieces ==================================== */

function stepRow(s, units) {
  const k = KINDS[s.type];
  const target = stepTarget(s, units);
  // The note is the coach's own words, so it outranks any generated line.
  const meta = s.note
    ? s.note
    : target
      ? "Target " + target
      : s.durType === "open"
        ? "Press lap to continue"
        : "No target — easy";
  return el(
    "div",
    { class: "tl-item" },
    el("div", { class: "tl-bar", style: "background:" + k.color }),
    el(
      "div",
      { class: "tl-body" },
      el("div", { class: "tl-title" }, (s.label || k.label) + " — " + stepAmount(s, units)),
      el("div", { class: "tl-meta" }, meta),
      s.note && target ? el("div", { class: "tl-meta" }, "Target " + target) : null
    )
  );
}

function timeline(w) {
  const box = el("div", {});
  for (const b of w.blocks) {
    if (b.kind === "repeat") {
      const g = el("div", { class: "rep-group" }, el("div", { class: "rep-label" }, b.reps + " × repeat"));
      for (const s of b.steps) g.append(stepRow(s, w.units));
      box.append(g);
    } else {
      box.append(stepRow(b, w.units));
    }
  }
  return box;
}

function acc(iconHtml, title, subtitle, body, open) {
  return el(
    "details",
    { class: "acc", open: !!open },
    el(
      "summary",
      {},
      el("div", { class: "ic", html: iconHtml }),
      el(
        "div",
        {},
        el("div", { class: "acc-t" }, title),
        subtitle ? el("div", { class: "acc-s" }, subtitle) : null
      ),
      el("div", { class: "caret", html: ICON.caret })
    ),
    el("div", { class: "acc-body stack" }, body)
  );
}

/** The step-by-step table an athlete copies into the watch's workout editor. */
function garminSteps(w) {
  const list = el("ol", { class: "steps" });
  const line = (s) => {
    const k = KINDS[s.type];
    const t = stepTarget(s, w.units);
    const bits = [
      el("b", {}, k.gc),
      " → ",
      s.durType === "distance" ? "Distance " : s.durType === "time" ? "Duration " : "",
      el("span", { class: "mono" }, stepAmount(s, w.units)),
    ];
    if (t) bits.push(", target ", el("span", { class: "mono" }, t));
    if (s.note) bits.push(", note ", el("span", { class: "mono" }, "“" + s.note + "”"));
    return bits;
  };
  for (const b of w.blocks) {
    if (b.kind === "repeat") {
      const sub = el("ol", { class: "steps", style: "margin-top:6px" });
      for (const s of b.steps) sub.append(el("li", {}, line(s)));
      list.append(
        el("li", {}, [
          el("b", {}, "Repeat"),
          " → ",
          el("span", { class: "mono" }, b.reps + " times"),
          ", containing:",
          sub,
        ])
      );
    } else {
      list.append(el("li", {}, line(b)));
    }
  }
  return list;
}

function fitButton(w, label) {
  const fitName = slug(w.name) + ".fit";
  return el(
    "button",
    {
      class: "btn primary block",
      onclick: () => {
        try {
          downloadBytes(buildFitFile(w), fitName, "application/vnd.ant.fit");
          toast("Downloaded " + fitName);
        } catch (e) {
          toast("Could not build the file");
          console.error(e);
        }
      },
    },
    el("span", { html: ICON.down }),
    (label || "Download") + " " + fitName
  );
}

/* ===================== the connect card ================================= */

/**
 * "Send it straight to my watch."
 *
 * The athlete approves WE RUN on intervals.icu once; from then on a single
 * tap drops the session on their calendar, and intervals.icu forwards it to
 * Garmin Connect. See js/connect.js for the full chain.
 */
function connectCard(w) {
  const body = el("div", { class: "stack" });
  const card = el(
    "div",
    { class: "card pad stack", style: "border-color:var(--brand)" },
    el(
      "div",
      { class: "row" },
      el("div", { class: "ic", html: ICON.send }),
      el(
        "div",
        {},
        el("div", { class: "acc-t" }, "Send it to my watch"),
        el("div", { class: "acc-s" }, "One tap, no typing — after you approve it once")
      )
    ),
    body
  );

  const show = (nodes) => {
    body.textContent = "";
    [].concat(nodes).forEach((n) => n && body.append(n));
  };

  /* --- not linked yet --------------------------------------------------- */
  function askToLink(msg) {
    show([
      msg ? el("div", { class: "status" }, el("span", { class: "dot err" }), msg) : null,
      el(
        "p",
        { class: "small muted" },
        "Garmin has no way to accept a workout from a link directly, so ",
        el("b", {}, "intervals.icu"),
        " does it for us — it's free, it's an official Garmin partner, and it uploads planned " +
          "sessions into Garmin Connect for you."
      ),
      el(
        "ol",
        { class: "steps small" },
        el("li", {}, "Tap the button — intervals.icu asks you to approve ", el("b", {}, CONFIG.clubName), "."),
        el("li", {}, "Over there, link your Garmin account once and tick ", el("b", {}, "Upload planned workouts"), "."),
        el("li", {}, "Come back here and every future session is one tap.")
      ),
      el(
        "button",
        { class: "btn primary block lg", onclick: () => Connect.begin() },
        el("span", { html: ICON.send }),
        "Connect my watch"
      ),
      el(
        "div",
        { class: "callout" },
        el("span", { html: ICON.shield, style: "display:none" }),
        "You approve this on intervals.icu's own page. ",
        el("b", {}, CONFIG.clubName),
        " never sees your Garmin or intervals.icu password, and can only add sessions to your calendar."
      ),
    ]);
  }

  /* --- linked, ready to send ------------------------------------------- */
  function ready(me) {
    const dateInput = el("input", { type: "date", value: w.date || todayISO() });
    const btn = el(
      "button",
      { class: "btn primary block lg" },
      el("span", { html: ICON.send }),
      "Send to my watch"
    );
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "";
      btn.append(el("span", { class: "spin" }), document.createTextNode("Sending…"));
      try {
        await Connect.push(w, dateInput.value);
        show([
          el(
            "div",
            { class: "status" },
            el("span", { class: "dot ok" }),
            el("span", {}, "Sent — it's on your calendar for " + prettyDate(dateInput.value) + ".")
          ),
          el(
            "p",
            { class: "small muted" },
            "It reaches Garmin Connect within a few minutes. Open Garmin Connect (or wait for the " +
              "watch to sync) and you'll find it under ",
            el("b", {}, "Training"),
            " on the day. On the watch: ",
            el("b", {}, "Run → Training → Workouts"),
            "."
          ),
          el("button", { class: "btn block", onclick: () => ready(me) }, "Send again / pick another day"),
        ]);
        toast("Session sent to your watch");
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "";
        btn.append(el("span", { html: ICON.send }), document.createTextNode("Try again"));
        show([el("div", { class: "status" }, el("span", { class: "dot err" }), e.message), dateRow, btn, unlink]);
      }
    });

    const dateRow = el("div", {}, el("label", {}, "Put it on"), dateInput);
    const unlink = el(
      "button",
      {
        class: "btn sm",
        onclick: () => {
          Connect.forget();
          askToLink(null);
        },
      },
      "Not me — disconnect"
    );

    const who = me && me.athlete ? me.athlete : "your intervals.icu account";
    const warn =
      me && me.garminLinked === false
        ? el(
            "div",
            { class: "status" },
            el("span", { class: "dot warn" }),
            el(
              "span",
              {},
              "Connected, but Garmin upload is off. Open ",
              el("a", { href: "https://intervals.icu/settings", target: "_blank", rel: "noopener" }, "intervals.icu settings"),
              " and tick “Upload planned workouts”, or the session will sit on the calendar only."
            )
          )
        : null;

    show([
      el("div", { class: "status" }, el("span", { class: "dot ok" }), "Connected as " + who),
      warn,
      dateRow,
      btn,
      unlink,
    ]);
  }

  /* --- decide what to show ---------------------------------------------- */
  if (!Connect.isLinked()) {
    askToLink(null);
  } else {
    show(el("div", { class: "status" }, el("span", { class: "spin" }), "Checking your connection…"));
    Connect.status()
      .then((me) => ready(me))
      .catch((e) => askToLink(e.message));
  }

  return card;
}

/* ===================== VIEWER (what the link opens) ====================== */

const DEVICE_KEY = "werun.device";

function renderViewer(app, w) {
  const est = estimate(w);
  const approx = est.exact ? "" : "~";

  app.append(brandBar(el("a", { class: "btn sm", href: location.pathname }, "New session")));

  /* --- session card ----------------------------------------------------- */
  app.append(
    el(
      "div",
      { class: "card pad stack" },
      el(
        "div",
        {},
        el("h1", {}, w.name),
        w.date ? el("p", { class: "muted small" }, prettyDate(w.date)) : null
      ),
      el(
        "div",
        { class: "chips" },
        el("span", { class: "chip" }, el("b", { class: "num" }, approx + fmtDuration(est.seconds))),
        est.workMeters
          ? el("span", { class: "chip" }, el("b", { class: "num" }, fmtDistance(est.workMeters, w.units)), "hard")
          : null,
        el("span", { class: "chip" }, el("b", { class: "num" }, String(est.steps)), "steps")
      ),
      w.note ? el("div", { class: "note" }, w.note) : null,
      el("div", { class: "divider" }),
      timeline(w),
      w.coach ? el("p", { class: "small muted" }, "Set by " + w.coach) : null
    )
  );

  /* --- device choice ----------------------------------------------------- */
  app.append(el("h3", { style: "margin:26px 0 4px" }, "Get it on your watch"));

  let device = "garmin";
  try {
    device = localStorage.getItem(DEVICE_KEY) || "garmin";
  } catch (e) {}

  const panel = el("div", { class: "stack", style: "margin-top:14px" });

  const pickBtn = (id, iconHtml, title, sub) =>
    el(
      "button",
      {
        class: "pick",
        "aria-pressed": device === id ? "true" : "false",
        onclick: () => {
          device = id;
          try {
            localStorage.setItem(DEVICE_KEY, id);
          } catch (e) {}
          drawPicker();
          drawPanel();
        },
      },
      el("span", { html: iconHtml }),
      el("span", { class: "t" }, title),
      el("span", { class: "s" }, sub)
    );

  const picker = el("div", { class: "picker" });
  function drawPicker() {
    picker.textContent = "";
    picker.append(
      pickBtn("garmin", ICON.garmin, "Garmin", "Forerunner, Fenix, Venu…"),
      pickBtn("apple", ICON.apple, "Apple Watch", "watchOS 9 or newer")
    );
  }
  drawPicker();
  app.append(picker, panel);

  function drawPanel() {
    panel.textContent = "";
    if (device === "garmin") drawGarmin();
    else drawApple();
    panel.append(textCard(w));
  }

  /* --- Garmin ------------------------------------------------------------ */
  function drawGarmin() {
    if (Connect.isEnabled()) panel.append(connectCard(w));

    panel.append(
      acc(
        ICON.garmin,
        "Type it into Garmin Connect",
        "About a minute — every number is worked out below",
        [
          el(
            "p",
            { class: "small muted" },
            "Garmin can't import a workout from a link, so this one is typed in. Nothing to work out — just copy the rows."
          ),
          el(
            "ol",
            { class: "steps" },
            el("li", {}, "Open ", el("b", {}, "Garmin Connect"), " → ", el("b", {}, "More"), " → ", el("b", {}, "Training & Planning"), " → ", el("b", {}, "Workouts")),
            el("li", {}, el("b", {}, "Create a Workout"), " → ", el("b", {}, "Run")),
            el(
              "li",
              {},
              "Name it ",
              el("span", { class: "mono" }, "“" + w.name + "”"),
              " ",
              el("button", { class: "btn icon", onclick: () => copyText(w.name, "Name copied") }, "copy")
            ),
            el("li", {}, "Add these steps:", el("div", { style: "margin-top:8px" }, garminSteps(w)))
          ),
          el(
            "p",
            { class: "small muted" },
            "For a ",
            el("b", {}, "lap button"),
            " step pick “Lap Button Press” as the end condition — the ~time is only Garmin's estimate and won't stop the step."
          ),
          el(
            "p",
            { class: "small muted" },
            "Save it, then hit ",
            el("b", {}, "Send to Device"),
            " (or just sync). On the watch: ",
            el("b", {}, "Run → Training → Workouts"),
            "."
          ),
        ],
        !Connect.isEnabled()
      )
    );

    panel.append(
      acc(ICON.cable, "Copy a file over USB", "No typing, but you need a computer and the cable", [
        el(
          "p",
          { class: "small muted" },
          "Garmin Connect itself can't import workout files — this puts one straight on the watch instead."
        ),
        fitButton(w),
        el(
          "ol",
          { class: "steps" },
          el("li", {}, "Plug the watch into a computer with its cable."),
          el("li", {}, "Open the ", el("b", {}, "GARMIN"), " drive → ", el("b", {}, "GARMIN"), " folder → ", el("b", {}, "NewFiles"), " (create it if it isn't there)."),
          el("li", {}, "Copy the file into it, then eject and unplug."),
          el("li", {}, "On the watch: ", el("b", {}, "Run → Training → Workouts"), ".")
        ),
      ])
    );
  }

  /* --- Apple ------------------------------------------------------------- */
  function drawApple() {
    panel.append(
      el(
        "div",
        { class: "callout" },
        "Apple has no way to send a workout to a watch from the web — not from us, not from anyone. ",
        "The Workout app builds custom sessions on the watch itself, so this one is tapped in once."
      )
    );

    panel.append(
      acc(
        ICON.apple,
        "Build it in the Workout app",
        "watchOS 9 or newer — it saves, so you only do this once",
        [
          el(
            "ol",
            { class: "steps" },
            el("li", {}, "On the watch open ", el("b", {}, "Workout"), " → the ", el("b", {}, "•••"), " on ", el("b", {}, "Outdoor Run")),
            el("li", {}, el("b", {}, "Create Workout"), " → ", el("b", {}, "Custom")),
            el("li", {}, "Add a warm-up, then ", el("b", {}, "Add Interval Block"), " for the reps, then the cool-down."),
            el("li", {}, "The numbers:", el("div", { style: "margin-top:8px" }, garminSteps(w)))
          ),
          el(
            "p",
            { class: "small muted" },
            "Pace targets go in as ",
            el("b", {}, "Pace"),
            " goals on each work step. Recoveries are ",
            el("b", {}, "Time"),
            " goals."
          ),
        ],
        true
      )
    );

    panel.append(
      acc(ICON.down, "Or use an app that imports", "WorkOutDoors and similar read the file below", [
        el(
          "p",
          { class: "small muted" },
          "If you'd rather not tap it out, apps like ",
          el("b", {}, "WorkOutDoors"),
          " or ",
          el("b", {}, "Intervals.icu"),
          " take a structured workout on iPhone and run it on the watch."
        ),
        fitButton(w, "Download"),
      ])
    );
  }

  /* --- always available -------------------------------------------------- */
  function textCard(w) {
    return acc(ICON.chat, "Just the text", "For your notes or the group chat", [
      el(
        "pre",
        {
          class: "note mono small",
          style: "white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;overflow-x:auto",
        },
        asText(w)
      ),
      el(
        "button",
        { class: "btn block", onclick: () => copyText(asText(w), "Session copied") },
        el("span", { html: ICON.copy }),
        "Copy session text"
      ),
    ]);
  }

  drawPanel();

  /* --- share onwards ----------------------------------------------------- */
  app.append(
    el(
      "div",
      { class: "row", style: "margin-top:22px" },
      el(
        "button",
        {
          class: "btn grow",
          onclick: async () => {
            const data = { title: w.name, text: asText(w), url: location.href };
            if (navigator.share) {
              try {
                await navigator.share(data);
                return;
              } catch (e) {
                /* cancelled */
              }
            }
            copyText(location.href, "Link copied");
          },
        },
        el("span", { html: ICON.link }),
        "Share this session"
      )
    )
  );

  app.append(
    el("footer", {}, "WE RUN Coaching · ", el("a", { href: location.pathname }, "build your own session"))
  );
}

/* ===================== BUILDER (what the coach uses) ===================== */

function renderBuilder(app, w) {
  const rerender = () => {
    app.textContent = "";
    renderBuilder(app, w);
  };

  const outputs = {};
  function refresh() {
    const url = shareUrl(w);
    outputs.url.value = url;
    const est = estimate(w);
    const approx = est.exact ? "" : "~";
    outputs.summary.textContent =
      approx + fmtDuration(est.seconds) +
      (est.workMeters ? " · " + fmtDistance(est.workMeters, w.units) + " hard" : "") +
      " · " + est.steps + " steps";
    outputs.len.textContent = url.length + " characters";
  }

  app.append(brandBar());
  app.append(
    el(
      "div",
      { style: "margin-bottom:18px" },
      el("h1", {}, "This week's session"),
      el(
        "p",
        { class: "muted small", style: "margin-top:6px" },
        "Build it once, send one link. Anyone who opens it can get it onto a Garmin or Apple Watch."
      )
    )
  );

  /* --- session details --------------------------------------------------- */
  const field = (label, input) => el("div", {}, el("label", {}, label), input);
  const bind = (key, opts) =>
    el(
      "input",
      Object.assign(
        {
          value: w[key] || "",
          oninput: (e) => {
            w[key] = e.target.value;
            refresh();
          },
        },
        opts || {}
      )
    );

  app.append(
    el(
      "div",
      { class: "card pad stack" },
      field("Session name", bind("name", { placeholder: "Tuesday | WeRUN" })),
      el(
        "div",
        { class: "grid2" },
        field("Date (optional)", bind("date", { type: "date" })),
        field("Coach / club (optional)", bind("coach", { placeholder: "Coach Ahmed" }))
      ),
      field(
        "Note to the group (optional)",
        el("textarea", {
          placeholder: "Meet 6:30pm at the track. Bring water.",
          oninput: (e) => {
            w.note = e.target.value;
            refresh();
          },
        })
      ),
      field(
        "Pace units",
        el(
          "div",
          { class: "seg" },
          ...["km", "mi"].map((u) =>
            el(
              "button",
              {
                type: "button",
                "aria-pressed": w.units === u ? "true" : "false",
                onclick: () => {
                  w.units = u;
                  rerender();
                },
              },
              "min / " + u
            )
          )
        )
      )
    )
  );
  $("textarea", app).value = w.note || "";

  /* --- blocks ------------------------------------------------------------ */
  app.append(el("h3", { style: "margin:26px 0 10px" }, "Steps"));

  const list = el("div", {});
  w.blocks.forEach((b, i) => list.append(blockEditor(b, i, w, rerender, refresh)));
  app.append(list);

  app.append(
    el(
      "div",
      { class: "row", style: "margin-top:12px" },
      el(
        "button",
        {
          class: "btn grow",
          onclick: () => {
            w.blocks.push(blankStep("work"));
            rerender();
          },
        },
        el("span", { html: ICON.plus }),
        "Add step"
      ),
      el(
        "button",
        {
          class: "btn grow",
          onclick: () => {
            w.blocks.push({
              kind: "repeat",
              reps: 6,
              steps: [
                Object.assign(blankStep("work"), { target: { kind: "pace", fast: 240, slow: 255 } }),
                blankStep("recovery"),
              ],
            });
            rerender();
          },
        },
        el("span", { html: ICON.plus }),
        "Add repeat set"
      )
    )
  );

  /* --- share link -------------------------------------------------------- */
  outputs.summary = el("b", {});
  outputs.len = el("span", { class: "small muted" });
  outputs.url = el("input", { readonly: true, onclick: (e) => e.target.select() });

  app.append(
    el(
      "div",
      { class: "card pad stack", style: "margin-top:26px" },
      el("h2", {}, "Your shareable link"),
      el(
        "p",
        { class: "small muted" },
        "The session is encoded in the link itself — nothing is uploaded, and old links keep working forever."
      ),
      el("div", { class: "linkbox" }, outputs.url),
      el(
        "div",
        { class: "row-wrap" },
        el(
          "button",
          {
            class: "btn primary grow",
            onclick: () => copyText(shareUrl(w), "Link copied — paste it in the group"),
          },
          el("span", { html: ICON.link }),
          "Copy link"
        ),
        el(
          "a",
          {
            class: "btn grow",
            href: "#",
            onclick: (e) => {
              e.preventDefault();
              location.hash = "w=" + encodeWorkout(w);
            },
          },
          "Preview it"
        )
      ),
      el("div", { class: "row-wrap small muted" }, outputs.summary, el("span", {}, "·"), outputs.len)
    )
  );

  app.append(
    el(
      "footer",
      {},
      Connect.isEnabled()
        ? "Athletes who connect once get every future session with a single tap."
        : "One-tap delivery is switched off — see the README to turn it on."
    )
  );

  refresh();
}

/** One editable block: either a single step or a repeat set. */
function blockEditor(b, index, w, rerender, refresh) {
  const move = (dir) => {
    const j = index + dir;
    if (j < 0 || j >= w.blocks.length) return;
    const tmp = w.blocks[index];
    w.blocks[index] = w.blocks[j];
    w.blocks[j] = tmp;
    rerender();
  };
  const controls = el(
    "div",
    { class: "row", style: "margin-left:auto;gap:4px" },
    el("button", { class: "btn icon", title: "Move up", onclick: () => move(-1) }, "↑"),
    el("button", { class: "btn icon", title: "Move down", onclick: () => move(1) }, "↓"),
    el(
      "button",
      {
        class: "btn icon",
        title: "Remove",
        onclick: () => {
          w.blocks.splice(index, 1);
          rerender();
        },
      },
      "✕"
    )
  );

  if (b.kind === "repeat") {
    const inner = el("div", { class: "rep-inner" });
    b.steps.forEach((s, i) =>
      inner.append(
        stepEditor(s, w, rerender, refresh, () => {
          b.steps.splice(i, 1);
          if (!b.steps.length) w.blocks.splice(index, 1);
          rerender();
        })
      )
    );
    return el(
      "div",
      { class: "blk" },
      el(
        "div",
        { class: "blk-head" },
        el("span", { class: "tag", style: "background:var(--repeat)" }, "Repeat"),
        el("input", {
          type: "number",
          min: "1",
          max: "99",
          value: b.reps,
          style: "width:70px",
          oninput: (e) => {
            b.reps = Math.max(1, parseInt(e.target.value, 10) || 1);
            refresh();
          },
        }),
        el("span", { class: "small muted" }, "times"),
        controls
      ),
      inner,
      el(
        "button",
        {
          class: "btn sm",
          style: "margin-top:10px",
          onclick: () => {
            b.steps.push(blankStep("work"));
            rerender();
          },
        },
        "+ step inside"
      )
    );
  }

  return stepEditor(b, w, rerender, refresh, null, controls);
}

/** Editor for a single step. */
function stepEditor(s, w, rerender, refresh, onRemove, controls) {
  const k = KINDS[s.type];

  const kindSel = el(
    "select",
    {
      onchange: (e) => {
        s.type = e.target.value;
        rerender();
      },
    },
    ...KIND_ORDER.map((key) => el("option", { value: key, selected: key === s.type }, KINDS[key].label))
  );

  /* duration */
  const durSel = el(
    "select",
    {
      onchange: (e) => {
        s.durType = e.target.value;
        rerender();
      },
    },
    el("option", { value: "distance", selected: s.durType === "distance" }, "Distance"),
    el("option", { value: "time", selected: s.durType === "time" }, "Time"),
    el("option", { value: "open", selected: s.durType === "open" }, "Lap button")
  );

  let durInput;
  if (s.durType === "time") {
    durInput = el("input", {
      value: fmtClock(s.seconds),
      placeholder: "mm:ss",
      inputmode: "numeric",
      oninput: (e) => {
        const v = parseClock(e.target.value);
        if (v != null) s.seconds = v;
        e.target.style.borderColor = v == null ? "var(--err)" : "";
        refresh();
      },
    });
  } else if (s.durType === "distance") {
    durInput = el("input", {
      type: "number",
      min: "10",
      step: "10",
      value: Math.round(s.meters),
      oninput: (e) => {
        s.meters = Math.max(1, parseFloat(e.target.value) || 0);
        refresh();
      },
    });
  } else {
    // Lap-button steps have no set length; this is only the planning estimate
    // Garmin shows as "~15min" next to the step.
    durInput = el("input", {
      value: s.estSeconds ? fmtClock(s.estSeconds) : "",
      placeholder: "~ mm:ss",
      inputmode: "numeric",
      oninput: (e) => {
        const v = e.target.value.trim();
        const parsed = v ? parseClock(v) : 0;
        if (parsed != null) s.estSeconds = parsed;
        e.target.style.borderColor = parsed == null ? "var(--err)" : "";
        refresh();
      },
    });
  }

  /* target */
  const tgtKind = (s.target && s.target.kind) || "none";
  const tgtSel = el(
    "select",
    {
      onchange: (e) => {
        const v = e.target.value;
        s.target =
          v === "pace"
            ? { kind: "pace", fast: 240, slow: 255 }
            : v === "hr"
              ? { kind: "hr", low: 150, high: 165 }
              : { kind: "none" };
        rerender();
      },
    },
    el("option", { value: "none", selected: tgtKind === "none" }, "No target"),
    el("option", { value: "pace", selected: tgtKind === "pace" }, "Pace"),
    el("option", { value: "hr", selected: tgtKind === "hr" }, "Heart rate")
  );

  const targetFields = [];
  if (tgtKind === "pace") {
    const mk = (which, label) =>
      el(
        "div",
        {},
        el("label", {}, label),
        el("input", {
          value: fmtClock(s.target[which]),
          placeholder: "mm:ss",
          inputmode: "numeric",
          oninput: (e) => {
            const v = parseClock(e.target.value);
            if (v != null) s.target[which] = v;
            e.target.style.borderColor = v == null ? "var(--err)" : "";
            refresh();
          },
        })
      );
    targetFields.push(mk("fast", "Fastest /" + w.units), mk("slow", "Slowest /" + w.units));
  } else if (tgtKind === "hr") {
    const mk = (which, label) =>
      el(
        "div",
        {},
        el("label", {}, label),
        el("input", {
          type: "number",
          min: "60",
          max: "230",
          value: s.target[which],
          oninput: (e) => {
            s.target[which] = parseInt(e.target.value, 10) || 0;
            refresh();
          },
        })
      );
    targetFields.push(mk("low", "Low bpm"), mk("high", "High bpm"));
  }

  return el(
    "div",
    { class: "blk" },
    el(
      "div",
      { class: "blk-head" },
      el("span", { class: "tag", style: "background:" + k.color }, k.label),
      controls ||
        (onRemove
          ? el(
              "div",
              { class: "row", style: "margin-left:auto" },
              el("button", { class: "btn icon", onclick: onRemove }, "✕")
            )
          : null)
    ),
    el(
      "div",
      { class: "grid3" },
      el("div", {}, el("label", {}, "Type"), kindSel),
      el("div", {}, el("label", {}, "Ends on"), durSel),
      el(
        "div",
        {},
        el("label", {}, s.durType === "distance" ? "Metres" : s.durType === "open" ? "Est. length" : "Length"),
        durInput
      )
    ),
    el("div", { class: "grid3", style: "margin-top:8px" }, el("div", {}, el("label", {}, "Target"), tgtSel), ...targetFields),
    el(
      "div",
      { class: "grid2", style: "margin-top:8px" },
      el(
        "div",
        {},
        el("label", {}, "Step name"),
        el("input", {
          value: s.label || "",
          placeholder: k.label,
          oninput: (e) => {
            s.label = e.target.value;
            refresh();
          },
        })
      ),
      el(
        "div",
        {},
        el("label", {}, "Note"),
        el("input", {
          value: s.note || "",
          placeholder: "ABC drills, @mile pace…",
          oninput: (e) => {
            s.note = e.target.value;
            refresh();
          },
        })
      )
    )
  );
}
