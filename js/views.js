"use strict";

/* =========================================================================
   WE RUN Coaching — the athlete-facing viewer and the coach-facing builder.

   All user-facing text goes through t() (js/i18n.js). Sentences that need
   emphasis are written once with **bold** markers and rendered by rich().
   ========================================================================= */

/* ===================== shared pieces ==================================== */

function stepRow(s, units) {
  const k = KINDS[s.type];
  const target = stepTarget(s, units);
  // The note is the coach's own words, so it outranks any generated line.
  const meta = s.note
    ? s.note
    : target
      ? t("targetIs") + target
      : s.durType === "open"
        ? t("pressLap")
        : t("noTargetEasy");
  return el(
    "div",
    { class: "tl-item" },
    el("div", { class: "tl-bar", style: "background:" + k.color }),
    el(
      "div",
      { class: "tl-body" },
      el("div", { class: "tl-title" }, (s.label || kindLabel(s.type)) + " — " + stepAmount(s, units)),
      el("div", { class: "tl-meta" }, meta),
      s.note && target ? el("div", { class: "tl-meta" }, t("targetIs") + target) : null
    )
  );
}

function timeline(w) {
  const box = el("div", {});
  for (const b of w.blocks) {
    if (b.kind === "repeat") {
      const g = el("div", { class: "rep-group" }, el("div", { class: "rep-label" }, b.reps + " " + t("repeatX")));
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

/**
 * The step table an athlete copies into the watch's workout editor.
 * Garmin's own UI words stay in English alongside the translation, because
 * that's what the athlete has to find on screen.
 */
function garminSteps(w) {
  const list = el("ol", { class: "steps" });
  const stepName = (type) =>
    I18N.lang === "en" ? KINDS[type].gc : kindLabel(type) + " (" + KINDS[type].gc + ")";

  const line = (s) => {
    const target = stepTarget(s, w.units);
    const bits = [
      el("b", {}, stepName(s.type)),
      " → ",
      s.durType === "distance" ? t("gcDistance") : s.durType === "time" ? t("gcDuration") : "",
      el("span", { class: "mono" }, stepAmount(s, w.units)),
    ];
    if (target) bits.push(t("gcTargetWord"), el("span", { class: "mono" }, target));
    if (s.note) bits.push(t("gcNoteWord"), el("span", { class: "mono" }, "“" + s.note + "”"));
    return bits;
  };

  for (const b of w.blocks) {
    if (b.kind === "repeat") {
      const sub = el("ol", { class: "steps", style: "margin-top:6px" });
      for (const s of b.steps) sub.append(el("li", {}, line(s)));
      list.append(
        el("li", {}, [
          el("b", {}, t("gcRepeat")),
          " → ",
          el("span", { class: "mono" }, b.reps + " " + t("gcTimes")),
          t("gcContaining"),
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
          toast(t("downloaded") + fitName);
        } catch (e) {
          toast(t("fitFailed"));
          console.error(e);
        }
      },
    },
    el("span", { html: ICON.down }),
    (label || t("download")) + " " + fitName
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
        el("div", { class: "acc-t" }, t("cTitle")),
        el("div", { class: "acc-s" }, t("cSub"))
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
    const club = CONFIG.clubName;
    show([
      msg ? el("div", { class: "status" }, el("span", { class: "dot err" }), msg) : null,
      el("p", { class: "small muted" }, rich(t("cWhy"))),
      el(
        "ol",
        { class: "steps small" },
        el("li", {}, rich(t("cStep1", { club: club }))),
        el("li", {}, rich(t("cStep2"))),
        el("li", {}, rich(t("cStep3")))
      ),
      el(
        "button",
        { class: "btn primary block lg", onclick: () => Connect.begin() },
        el("span", { html: ICON.send }),
        t("cConnect")
      ),
      el("div", { class: "callout" }, rich(t("cPrivacy", { club: club }))),
    ]);
  }

  /* --- linked, ready to send ------------------------------------------- */
  function ready(me) {
    const dateInput = el("input", { type: "date", value: w.date || todayISO() });
    const dateRow = el("div", {}, el("label", {}, t("cPutItOn")), dateInput);
    const unlink = el(
      "button",
      {
        class: "btn sm",
        onclick: () => {
          Connect.forget();
          askToLink(null);
        },
      },
      t("cDisconnect")
    );

    const btn = el("button", { class: "btn primary block lg" }, el("span", { html: ICON.send }), t("cSend"));
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "";
      btn.append(el("span", { class: "spin" }), document.createTextNode(t("cSending")));
      try {
        await Connect.push(w, dateInput.value);
        show([
          el(
            "div",
            { class: "status" },
            el("span", { class: "dot ok" }),
            el("span", {}, t("cSentMsg", { date: prettyDate(dateInput.value) }))
          ),
          el("p", { class: "small muted" }, rich(t("cSentHow"))),
          el("button", { class: "btn block", onclick: () => ready(me) }, t("cSendAgain")),
        ]);
        toast(t("cSentToast"));
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "";
        btn.append(el("span", { html: ICON.send }), document.createTextNode(t("cTryAgain")));
        show([el("div", { class: "status" }, el("span", { class: "dot err" }), e.message), dateRow, btn, unlink]);
      }
    });

    const who = me && me.athlete ? me.athlete : t("cYourAccount");
    const warn =
      me && me.garminLinked === false
        ? el(
            "div",
            { class: "status" },
            el("span", { class: "dot warn" }),
            el(
              "span",
              {},
              t("cGarminOffPre"),
              el(
                "a",
                { href: "https://intervals.icu/settings", target: "_blank", rel: "noopener" },
                t("cGarminOffLink")
              ),
              t("cGarminOffPost")
            )
          )
        : null;

    show([
      el("div", { class: "status" }, el("span", { class: "dot ok" }), t("cConnectedAs") + who),
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
    show(el("div", { class: "status" }, el("span", { class: "spin" }), t("cChecking")));
    Connect.status()
      .then((me) => ready(me))
      .catch((e) => askToLink(e.message));
  }

  return card;
}

/* ===================== VIEWER (what the link opens) ====================== */

const DEVICE_KEY = "werun.device";

/**
 * The athlete's view of a session.
 *
 * `opts.chrome === false` leaves off the header and the footer link back to
 * the builder: the club app draws this inside its own shell, where a second
 * logo and a link out to the builder would both be wrong.
 */
function renderViewer(app, w, rerender, opts) {
  const est = estimate(w);
  const approx = est.exact ? "" : "~";
  const chrome = !opts || opts.chrome !== false;

  if (chrome) app.append(brandBar(null, rerender));

  /* --- session card ----------------------------------------------------- */
  // The calculator lives beside the title: the paces it gives are the targets
  // for the very steps listed underneath it.
  const pace = paceCalculator(w.units);

  // Coach Tips sits between the session name and the calculator: her
  // words about the running, next to the numbers for it. Both the button and
  // the cloud stay out of the page entirely unless she has an article live.
  const corner = tipsCorner();

  // One at a time. They open off buttons an inch apart and both push the
  // session down the page, so whichever is asked for wins and the other folds
  // away — silently, since the one being opened is already making its noise.
  pace.onOpen = () => corner.close();
  corner.onOpen = () => pace.close();

  app.append(
    el(
      "div",
      { class: "card pad stack" },
      el(
        "div",
        { class: "sess-head" },
        el(
          "div",
          { class: "grow" },
          el("h1", {}, w.name),
          w.date ? el("p", { class: "muted small" }, prettyDate(w.date)) : null
        ),
        corner.button,
        pace.button
      ),
      corner.cloud,
      corner.scrim,
      pace.panel,
      el(
        "div",
        { class: "chips" },
        el("span", { class: "chip" }, el("b", { class: "num" }, approx + fmtDuration(est.seconds))),
        // The whole distance first, then how much of it is the hard work.
        // Always a ~: the easy half is a six-minute-kilometre rule of thumb.
        est.easyMeters
          ? el("span", { class: "chip" }, el("b", { class: "num" }, "~" + fmtDistanceRough(est.totalMeters, w.units)))
          : null,
        est.workMeters
          ? el("span", { class: "chip" }, el("b", { class: "num" }, fmtDistance(est.workMeters, w.units)), t("hard"))
          : null,
        el("span", { class: "chip" }, el("b", { class: "num" }, String(est.steps)), t("stepsCount"))
      ),
      w.note ? el("div", { class: "note" }, w.note) : null,
      el("div", { class: "divider" }),
      timeline(w),
      w.coach ? el("p", { class: "small muted" }, t("setBy") + w.coach) : null
    )
  );

  /* --- device choice ----------------------------------------------------- */
  app.append(el("h3", { style: "margin:26px 0 4px" }, t("getItOn")));

  let device = "garmin";
  try {
    device = localStorage.getItem(DEVICE_KEY) || "garmin";
  } catch (e) {}

  const picker = el("div", { class: "picker" });
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

  function drawPicker() {
    picker.textContent = "";
    picker.append(
      pickBtn("garmin", ICON.garmin, t("garmin"), t("garminSub")),
      pickBtn("coros", ICON.coros, t("coros"), t("corosSub")),
      pickBtn("apple", ICON.apple, t("apple"), t("appleSub"))
    );
  }
  drawPicker();
  app.append(picker, panel);

  function drawPanel() {
    panel.textContent = "";
    if (device === "garmin") drawGarmin();
    else if (device === "coros") drawCoros();
    else drawApple();
    panel.append(textCard());
  }

  /* --- Garmin ------------------------------------------------------------ */
  function drawGarmin() {
    if (Connect.isEnabled()) panel.append(connectCard(w));

    panel.append(
      acc(
        ICON.garmin,
        t("rTypeIn"),
        t("rTypeInSub"),
        [
          el("p", { class: "small muted" }, t("rTypeInLead")),
          el(
            "ol",
            { class: "steps" },
            el("li", {}, rich(t("gcStep1"))),
            el("li", {}, rich(t("gcStep2"))),
            el(
              "li",
              {},
              t("gcStep3") + " ",
              el("span", { class: "mono" }, "“" + w.name + "”"),
              " ",
              el("button", { class: "btn icon", onclick: () => copyText(w.name, t("nameCopied")) }, t("copy"))
            ),
            el("li", {}, t("gcStep4"), el("div", { style: "margin-top:8px" }, garminSteps(w)))
          ),
          el("p", { class: "small muted" }, rich(t("gcLap"))),
          el("p", { class: "small muted" }, rich(t("gcSave"))),
        ],
        !Connect.isEnabled()
      )
    );

    panel.append(
      acc(ICON.cable, t("rUsb"), t("rUsbSub"), [
        el("p", { class: "small muted" }, t("rUsbLead")),
        fitButton(w),
        el(
          "ol",
          { class: "steps" },
          el("li", {}, rich(t("usb1"))),
          el("li", {}, rich(t("usb2"))),
          el("li", {}, rich(t("usb3"))),
          el("li", {}, rich(t("usb4")))
        ),
      ])
    );
  }

  /* --- COROS ------------------------------------------------------------- */
  function drawCoros() {
    panel.append(el("div", { class: "callout" }, t("rCorosWarn")));

    panel.append(
      acc(
        ICON.coros,
        t("rCoros"),
        t("rCorosSub"),
        [
          el(
            "ol",
            { class: "steps" },
            el("li", {}, rich(t("co1"))),
            el(
              "li",
              {},
              t("co2") + " ",
              el("span", { class: "mono" }, "\u201C" + w.name + "\u201D"),
              " ",
              el("button", { class: "btn icon", onclick: () => copyText(w.name, t("nameCopied")) }, t("copy"))
            ),
            el("li", {}, rich(t("co3"))),
            el("li", {}, t("co4"), el("div", { style: "margin-top:8px" }, garminSteps(w)))
          ),
          el("p", { class: "small muted" }, rich(t("coPace"))),
        ],
        true
      )
    );

    panel.append(
      acc(ICON.link, t("rCorosTp"), t("rCorosTpSub"), [
        el("p", { class: "small muted" }, rich(t("coTpLead"))),
      ])
    );
  }

  /* --- Apple ------------------------------------------------------------- */
  function drawApple() {
    panel.append(el("div", { class: "callout" }, t("rAppleWarn")));

    panel.append(
      acc(
        ICON.apple,
        t("rApple"),
        t("rAppleSub"),
        [
          el(
            "ol",
            { class: "steps" },
            el("li", {}, rich(t("ap1"))),
            el("li", {}, rich(t("ap2"))),
            el("li", {}, rich(t("ap3"))),
            el("li", {}, t("ap4"), el("div", { style: "margin-top:8px" }, garminSteps(w)))
          ),
          el("p", { class: "small muted" }, rich(t("apPace"))),
        ],
        true
      )
    );

    panel.append(
      acc(ICON.down, t("rAppleImport"), t("rAppleImportSub"), [
        el("p", { class: "small muted" }, rich(t("apImportLead"))),
        fitButton(w),
      ])
    );
  }

  /* --- always available -------------------------------------------------- */
  function textCard() {
    return acc(ICON.chat, t("rText"), t("rTextSub"), [
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
        { class: "btn block", onclick: () => copyText(asText(w), t("sessionCopied")) },
        el("span", { html: ICON.copy }),
        t("copySessionText")
      ),
    ]);
  }

  drawPanel();

  /* --- the foot: their say, and the ways onwards ------------------------- */
  const share = el(
    "button",
    {
      class: "btn lg block share-cta",
      "data-sfx": "share", // its own sound: this tap is for someone else
      onclick: async () => {
        countShare(w);
        const data = { title: w.name, text: asText(w), url: location.href };
        if (navigator.share) {
          try {
            await navigator.share(data);
            return;
          } catch (e) {
            /* cancelled */
          }
        }
        copyText(location.href, t("linkCopied"));
      },
    },
    // The same comet that laps the pace and tips buttons, so the three
    // things on the page worth pressing all announce themselves the same way.
    el("span", { class: "share-glow", "aria-hidden": "true" }),
    el("span", { class: "share-face" }, el("span", { html: ICON.link }), t("shareSession"))
  );

  // Three things, one grid, two arrangements — see .foot-row in index.html.
  // On a wide screen the rating box takes the width and the share link sits
  // beside it, because an athlete reaching the foot of the session has just
  // finished reading it and that is the one moment they have an opinion to
  // give. On a phone they stack: link, box, then the club's socials right at
  // the end, which is where someone who is done with this session goes next.
  app.append(el("div", { class: "foot-row" }, feedbackCard(w), share, socialRow()));

  if (chrome) {
    app.append(
      el(
        "footer",
        {},
        "WE RUN Coaching · ",
        el("a", { href: location.pathname }, t("footerBuild"))
      )
    );
  }
}

/* ===================== BUILDER (what the coach uses) ===================== */

function renderBuilder(app, w, rerender) {
  // Every redraw comes from the coach changing something structural, so it
  // counts as an edit the same way typing in a field does.
  const redraw = () => {
    touched();
    app.textContent = "";
    renderBuilder(app, w, rerender);
  };

  // Once the coach edits anything it is their session, not a standing one, and
  // the picker stops claiming otherwise.
  const touched = () => {
    if (!w.preset) return;
    w.preset = null;
    pickerState();
  };

  const outputs = {};
  function paint() {
    const url = shareUrl(w);
    outputs.url.value = url;
    const est = estimate(w);
    const approx = est.exact ? "" : "~";
    outputs.summary.textContent =
      approx + fmtDuration(est.seconds) +
      (est.easyMeters ? " · ~" + fmtDistanceRough(est.totalMeters, w.units) : "") +
      (est.workMeters ? " · " + fmtDistance(est.workMeters, w.units) + " " + t("hard") : "") +
      " · " + est.steps + " " + t("stepsCount");
    outputs.len.textContent = url.length + " " + t("chars");
  }

  const refresh = () => {
    touched();
    paint();
  };

  app.append(brandBar(null, rerender));
  app.append(
    el(
      "div",
      { style: "margin-bottom:18px" },
      el("h1", {}, t("buildTitle")),
      el("p", { class: "muted small", style: "margin-top:6px" }, t("buildLead"))
    )
  );

  /* --- standing sessions -------------------------------------------------- */
  const pickBtns = SESSIONS.map((p) =>
    el(
      "button",
      {
        type: "button",
        "aria-pressed": w.preset === p.id ? "true" : "false",
        onclick: () => {
          if (w.preset === p.id) return;
          // Only nag when there is something to lose.
          if (!w.preset && !confirm(t("swapWarn", { day: t(p.day) }))) return;
          const next = p.build();
          next.preset = p.id;
          draft = next;
          rerender();
        },
      },
      t(p.day)
    )
  );
  const pickerState = () => {
    pickBtns.forEach((b, i) => b.setAttribute("aria-pressed", w.preset === SESSIONS[i].id ? "true" : "false"));
  };

  app.append(
    el(
      "div",
      { style: "margin-bottom:18px" },
      el("label", {}, t("sessions")),
      el("div", { class: "seg" }, ...pickBtns)
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
      field(t("fName"), bind("name", { placeholder: t("fNamePh") })),
      el(
        "div",
        { class: "grid2" },
        field(t("fDate"), bind("date", { type: "date" })),
        field(t("fCoach"), bind("coach", { placeholder: t("fCoachPh") }))
      ),
      field(
        t("fNote"),
        el("textarea", {
          placeholder: t("fNotePh"),
          oninput: (e) => {
            w.note = e.target.value;
            refresh();
          },
        })
      ),
      field(
        t("fUnits"),
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
                  redraw();
                },
              },
              u === "km" ? t("unitKm") : t("unitMi")
            )
          )
        )
      )
    )
  );
  $("textarea", app).value = w.note || "";

  /* --- blocks ------------------------------------------------------------ */
  app.append(el("h3", { style: "margin:26px 0 10px" }, t("steps")));

  const list = el("div", {});
  w.blocks.forEach((b, i) => list.append(blockEditor(b, i, w, redraw, refresh)));
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
            redraw();
          },
        },
        el("span", { html: ICON.plus }),
        t("addStep")
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
            redraw();
          },
        },
        el("span", { html: ICON.plus }),
        t("addRepeat")
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
      el("h2", {}, t("yourLink")),
      el("p", { class: "small muted" }, t("linkLead")),
      el("div", { class: "linkbox" }, outputs.url),
      el(
        "div",
        { class: "row-wrap" },
        el(
          "button",
          { class: "btn primary grow", onclick: () => copyText(shareUrl(w), t("linkCopied")) },
          el("span", { html: ICON.link }),
          t("copyLink")
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
          t("previewIt")
        )
      ),
      el("div", { class: "row-wrap small muted" }, outputs.summary, el("span", {}, "·"), outputs.len)
    )
  );

  app.append(
    el("footer", {}, socialRow(), Connect.isEnabled() ? t("connectFooterOn") : t("connectFooterOff"))
  );

  paint();
}

/** One editable block: either a single step or a repeat set. */
function blockEditor(b, index, w, redraw, refresh) {
  const move = (dir) => {
    const j = index + dir;
    if (j < 0 || j >= w.blocks.length) return;
    const tmp = w.blocks[index];
    w.blocks[index] = w.blocks[j];
    w.blocks[j] = tmp;
    redraw();
  };
  const controls = el(
    "div",
    { class: "row push", style: "gap:4px" },
    el("button", { class: "btn icon", title: t("eUp"), onclick: () => move(-1) }, "↑"),
    el("button", { class: "btn icon", title: t("eDown"), onclick: () => move(1) }, "↓"),
    el(
      "button",
      {
        class: "btn icon",
        title: t("eRemove"),
        onclick: () => {
          w.blocks.splice(index, 1);
          redraw();
        },
      },
      "✕"
    )
  );

  if (b.kind === "repeat") {
    const inner = el("div", { class: "rep-inner" });
    b.steps.forEach((s, i) =>
      inner.append(
        stepEditor(s, w, redraw, refresh, () => {
          b.steps.splice(i, 1);
          if (!b.steps.length) w.blocks.splice(index, 1);
          redraw();
        })
      )
    );
    return el(
      "div",
      { class: "blk" },
      el(
        "div",
        { class: "blk-head" },
        el("span", { class: "tag", style: "background:var(--repeat)" }, t("eRepeat")),
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
        el("span", { class: "small muted" }, t("eTimes")),
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
            redraw();
          },
        },
        t("eStepInside")
      )
    );
  }

  return stepEditor(b, w, redraw, refresh, null, controls);
}

/** Editor for a single step. */
function stepEditor(s, w, redraw, refresh, onRemove, controls) {
  const k = KINDS[s.type];

  const kindSel = el(
    "select",
    {
      onchange: (e) => {
        s.type = e.target.value;
        redraw();
      },
    },
    ...KIND_ORDER.map((key) => el("option", { value: key, selected: key === s.type }, kindLabel(key)))
  );

  /* duration */
  const durSel = el(
    "select",
    {
      onchange: (e) => {
        s.durType = e.target.value;
        redraw();
      },
    },
    el("option", { value: "distance", selected: s.durType === "distance" }, t("eDistance")),
    el("option", { value: "time", selected: s.durType === "time" }, t("eTime")),
    el("option", { value: "open", selected: s.durType === "open" }, t("eLap"))
  );

  let durInput;
  if (s.durType === "time") {
    durInput = el("input", {
      value: fmtClock(s.seconds),
      placeholder: "mm:ss",
      inputmode: "numeric",
      dir: "ltr",
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
      dir: "ltr",
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
      dir: "ltr",
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
        redraw();
      },
    },
    el("option", { value: "none", selected: tgtKind === "none" }, t("eNoTarget")),
    el("option", { value: "pace", selected: tgtKind === "pace" }, t("ePace")),
    el("option", { value: "hr", selected: tgtKind === "hr" }, t("eHr"))
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
          dir: "ltr",
          oninput: (e) => {
            const v = parseClock(e.target.value);
            if (v != null) s.target[which] = v;
            e.target.style.borderColor = v == null ? "var(--err)" : "";
            refresh();
          },
        })
      );
    targetFields.push(
      mk("fast", t("eFastest") + unitLabel(w.units)),
      mk("slow", t("eSlowest") + unitLabel(w.units))
    );
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
          dir: "ltr",
          oninput: (e) => {
            s.target[which] = parseInt(e.target.value, 10) || 0;
            refresh();
          },
        })
      );
    targetFields.push(mk("low", t("eLowBpm")), mk("high", t("eHighBpm")));
  }

  return el(
    "div",
    { class: "blk" },
    el(
      "div",
      { class: "blk-head" },
      el("span", { class: "tag", style: "background:" + k.color }, kindLabel(s.type)),
      controls ||
        (onRemove
          ? el("div", { class: "row push" }, el("button", { class: "btn icon", onclick: onRemove }, "✕"))
          : null)
    ),
    el(
      "div",
      { class: "grid3" },
      el("div", {}, el("label", {}, t("eType")), kindSel),
      el("div", {}, el("label", {}, t("eEnds")), durSel),
      el(
        "div",
        {},
        el("label", {}, s.durType === "distance" ? t("eMetres") : s.durType === "open" ? t("eEstLength") : t("eLength")),
        durInput
      )
    ),
    el("div", { class: "grid3", style: "margin-top:8px" }, el("div", {}, el("label", {}, t("eTarget")), tgtSel), ...targetFields),
    el(
      "div",
      { class: "grid2", style: "margin-top:8px" },
      el(
        "div",
        {},
        el("label", {}, t("eStepName")),
        el("input", {
          value: s.label || "",
          placeholder: kindLabel(s.type),
          oninput: (e) => {
            s.label = e.target.value;
            refresh();
          },
        })
      ),
      el(
        "div",
        {},
        el("label", {}, t("eNote")),
        el("input", {
          value: s.note || "",
          placeholder: t("eNotePh"),
          oninput: (e) => {
            s.note = e.target.value;
            refresh();
          },
        })
      )
    )
  );
}
