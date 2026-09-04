"use strict";

/* =========================================================================
   WE RUN Coaching — the athlete app (app.html).

   One page, hash routes:
     #/login  #/signup            anyone
     #/week   #/week/2026-09-07   the plan, one week at a time   (logged in)
     #/session/<id>               one session, in full
     #/c/<id>/<slot>/<sig>        what the coach's QR code points at
     #/points                     total, streak, history, the club board
     #/feed                       what the coach has written for the club
     #/verify/<token>             the link in the confirmation email
     #/reset  #/reset/<token>     ask for a new password, then set it
     #/me                         name, language, password, log out

   Everything visible goes through t() in js/i18n.js. The header comes from
   brandBar() like the link page, and its language and theme toggles call
   appBoot() again, so there is one code path that draws the app.
   ========================================================================= */

/* ---------- routing ------------------------------------------------------ */

const PUBLIC_ROUTES = ["login", "signup", "c", "verify", "reset"];

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { name: parts[0] || "", args: parts.slice(1) };
}

function go(path) {
  const next = "#/" + path;
  if (location.hash === next) render();
  else location.hash = next;
}

/** First paint: find out who is here, then draw. Also what the toggles call. */
async function appBoot() {
  const app = $("#app");
  if (Auth.user === undefined) {
    app.textContent = "";
    app.append(brandBar(null, appBoot), el("p", { class: "muted small" }, t("aLoading")));
    await Auth.load();
  }
  // The language toggle is the athlete's choice for every device, so it
  // follows them to the account. Quietly: the page has already switched.
  if (Auth.user && Auth.user.lang !== I18N.lang) Auth.update({ lang: I18N.lang }).catch(() => {});
  render();
}

/* A code scanned by someone not logged in yet.

   The link is held for exactly as long as it takes them to log in or join,
   in sessionStorage so it dies with the tab, and then replayed. Without this
   a first-time athlete at the track scans, meets a login form, and loses the
   code — which by the time they are back has expired anyway. */
const PENDING = "werun.checkin";

function stashCheckin(args) {
  try {
    sessionStorage.setItem(PENDING, args.join("/"));
  } catch (e) {}
}

function takeCheckin() {
  try {
    const v = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING);
    return v;
  } catch (e) {
    return null;
  }
}

/** After a login, go where they were headed rather than to the week. */
function afterLogin() {
  const pending = takeCheckin();
  go(pending ? "c/" + pending : "week");
}

function render() {
  const app = $("#app");
  const r = parseRoute();
  const user = Auth.user;

  if (!user && !PUBLIC_ROUTES.includes(r.name)) {
    // A code scanned by a stranger: keep it, then ask who they are.
    if (r.name === "c") stashCheckin(r.args);
    return go("login");
  }
  if (!user && r.name === "c") {
    stashCheckin(r.args);
    return go("login");
  }
  // verify and reset are reachable logged in as well as out: an athlete who
  // is already signed in still clicks the link in their mail.
  if (user && (r.name === "login" || r.name === "signup" || !r.name)) return go("week");

  app.textContent = "";
  document.title = "WE RUN Club";
  app.append(brandBar(null, appBoot));
  if (user) app.append(appNav(r.name));

  const banner = announcement();
  if (banner) app.append(banner);

  // With the site down, the account screen still works — an athlete must be
  // able to log out of a club that is mid-repair — and the coach sees
  // everything, since she is the one doing the repairing.
  if (Auth.club.maintenance && !Auth.isCoach() && r.name !== "me") {
    app.append(
      el(
        "div",
        { class: "card pad stack" },
        el("h2", {}, t("aDown")),
        el("p", { class: "muted" }, t("aDownLead"))
      )
    );
    return;
  }

  // hasOwn, not a bare lookup: "#/constructor" would otherwise find Object.
  const screen = Object.hasOwn(SCREENS, r.name) ? SCREENS[r.name] : SCREENS.week;
  app.append(screen(r.args, user));
}

/** The coach's line across the top of the app, in the reader's language. */
function announcement() {
  const text = I18N.lang === "ar"
    ? Auth.club.announcement_ar || Auth.club.announcement_en
    : Auth.club.announcement_en || Auth.club.announcement_ar;
  if (!text) return null;
  return el("div", { class: "announce", dir: "auto" }, text);
}

function appNav(current) {
  const link = (name, label) =>
    el("a", { href: "#/" + name, "aria-current": current === name ? "page" : null }, label);
  return el(
    "nav",
    { class: "appnav" },
    link("week", t("navWeek")),
    link("feed", t("navFeed2")),
    link("points", t("navPointsShort")),
    link("me", t("navMe"))
  );
}

/* ---------- small parts -------------------------------------------------- */

function field(labelKey, input, hint) {
  return el("div", {}, el("label", { for: input.id }, t(labelKey)), input, hint ? el("p", { class: "hint" }, hint) : null);
}

/** A form that disables its button while the promise runs and shows the error. */
function submitting(btn, err, work) {
  err.classList.add("hidden");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = t("aWorking");
  return work().catch((e) => {
    err.textContent = errorText(e);
    err.classList.remove("hidden");
  }).finally(() => {
    btn.disabled = false;
    btn.textContent = label;
  });
}

const localISO = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
const locale = () => (I18N.lang === "ar" ? "ar" : undefined);

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localISO(d);
}

/* ---------- screens ------------------------------------------------------ */

const SCREENS = {};

SCREENS.login = function () {
  const email = el("input", { type: "email", id: "f-email", autocomplete: "username", inputmode: "email", required: true });
  const pw = el("input", { type: "password", id: "f-pw", autocomplete: "current-password", required: true });
  const err = el("p", { class: "form-err hidden" });
  const btn = el("button", { class: "btn primary lg block", type: "submit" }, t("aLogin"));
  const form = el(
    "form",
    {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        submitting(btn, err, () => Auth.login(email.value.trim(), pw.value).then(afterLogin));
      },
    },
    field("aEmail", email),
    field("aPassword", pw),
    err,
    btn
  );
  return el(
    "div",
    { class: "card pad stack" },
    el("h2", {}, t("aLogin")),
    form,
    el("p", { class: "switch-link" }, t("aNoAccount") + " ", el("a", { href: "#/signup" }, t("aSignup"))),
    // Only offered when the club can actually send it.
    Auth.club.email === false ? null : el("p", { class: "switch-link" }, el("a", { href: "#/reset" }, t("aForgot")))
  );
};

SCREENS.signup = function () {
  const name = el("input", { type: "text", id: "f-name", autocomplete: "name", placeholder: t("aNamePh"), maxlength: 40, required: true });
  const email = el("input", { type: "email", id: "f-email", autocomplete: "username", inputmode: "email", required: true });
  const pw = el("input", { type: "password", id: "f-pw", autocomplete: "new-password", minlength: 8, required: true });
  const err = el("p", { class: "form-err hidden" });
  const btn = el("button", { class: "btn primary lg block", type: "submit" }, t("aSignup"));
  const form = el(
    "form",
    {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        submitting(btn, err, () => Auth.signup(name.value, email.value.trim(), pw.value).then(afterLogin));
      },
    },
    field("aName", name),
    field("aEmail", email),
    field("aPassword", pw, t("aPwHint")),
    err,
    btn
  );
  return el(
    "div",
    { class: "card pad stack" },
    el("h2", {}, t("aSignup")),
    el("p", { class: "muted small" }, t("aJoinLead")),
    form,
    el("p", { class: "switch-link" }, t("aHaveAccount") + " ", el("a", { href: "#/login" }, t("aLogin")))
  );
};

/* The week: seven cards, Monday first, the coach's sessions on the days
   they happen. Today is outlined; a session is a button into its detail. */
SCREENS.week = function (args) {
  const today = localISO(new Date());
  const thisMonday = localISO(mondayOf(new Date()));
  const start = /^\d{4}-\d{2}-\d{2}$/.test(args[0] || "") ? localISO(mondayOf(new Date(args[0] + "T00:00:00"))) : thisMonday;

  // icon() hands back markup, so it goes in through `html` rather than as text.
  const arrow = (dir) => el("span", { style: "display:inline-flex", html: icon(dir < 0 ? ICON_PATH.left : ICON_PATH.right) });
  const head = el(
    "div",
    { class: "week-head" },
    el("button", { class: "btn icon", "aria-label": t("aPrevWeek"), onclick: () => go("week/" + addDays(start, -7)) }, arrow(-1)),
    el("h2", {}, start === thisMonday ? t("aThisWeek") : t("aWeekOf", { date: shortDate(start) })),
    el("button", { class: "btn icon", "aria-label": t("aNextWeek"), onclick: () => go("week/" + addDays(start, 7)) }, arrow(1))
  );
  const list = el("div", { class: "days" }, el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));
  const card = el("div", { class: "card pad stack" }, head, list);

  API.get("/api/week?start=" + start)
    .then((data) => {
      list.textContent = "";
      const any = data.days.some((d) => d.session);
      for (const d of data.days) list.append(dayCard(d, today));
      if (!any) list.append(el("p", { class: "empty" }, t("aNoSessions")));
    })
    .catch((e) => {
      list.textContent = "";
      list.append(el("p", { class: "form-err" }, errorText(e)));
    });
  return card;
};

function shortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

function dayCard(d, today) {
  const date = new Date(d.date + "T00:00:00");
  const when = el(
    "div",
    { class: "day-date" },
    el("div", { class: "wd" }, date.toLocaleDateString(locale(), { weekday: "short" })),
    el("div", { class: "dm" }, date.toLocaleDateString(locale(), { day: "numeric", month: "short" }))
  );
  const s = d.session;
  const cls = "day" + (d.date === today ? " today" : "");
  if (!s) return el("div", { class: cls }, when, el("div", { class: "day-body" }, el("div", { class: "day-rest" }, t("aRest"))));

  const at = new Date(s.starts_at);
  const time = isNaN(at) ? "" : at.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return el(
    "button",
    { class: cls, type: "button", onclick: () => go("session/" + s.id) },
    when,
    el(
      "div",
      { class: "day-body" },
      el("div", { class: "day-title" }, s.name),
      el("div", { class: "day-meta" }, [time, t("aPts", { n: s.points })].filter(Boolean).join(" · "))
    ),
    statusTag(s)
  );
}

/** Where this session stands for this athlete, right now. */
function statusTag(s) {
  if (s.checked_in) return el("span", { class: "tag done" }, t("aCheckedIn"));
  const now = Date.now();
  const open = Date.parse(s.window_open_at);
  const close = Date.parse(s.window_close_at);
  if (now >= open && now <= close) return el("span", { class: "tag open" }, t("aOpenNow"));
  if (now > close) return el("span", { class: "tag miss" }, t("aMissed"));
  return el("span", { class: "tag soon" }, t("aUpcoming"));
}

/* One session, in full: the same timeline, typed Garmin steps, .fit file and
   pace calculator the share link gives, drawn by the very same code — with a
   check-in button on top while the window is open. */
SCREENS.session = function (args) {
  const box = el("div", { class: "stack" }, el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));

  API.get("/api/session?id=" + encodeURIComponent(args[0] || ""))
    .then((data) => {
      const s = data.session;
      box.textContent = "";
      box.append(checkinCard(s));
      let w = null;
      try {
        w = decodeWorkout(s.payload);
      } catch (e) {
        box.append(el("div", { class: "card pad" }, el("p", { class: "form-err" }, t("brokenLead"))));
        return;
      }
      // The date the coach published it for, not whatever the link carried.
      w.date = s.date;
      renderViewer(box, w, appBoot, { chrome: false });
    })
    .catch((e) => {
      box.textContent = "";
      box.append(el("div", { class: "card pad" }, el("p", { class: "form-err" }, errorText(e))));
    });

  return el(
    "div",
    { class: "stack" },
    el("button", { class: "btn sm backlink", onclick: () => go("week") }, t("aBack")),
    box
  );
};

/** The strip above a session: checked in, open now, or when it opens. */
function checkinCard(s) {
  const at = new Date(s.starts_at);
  const time = isNaN(at) ? "" : at.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

  if (s.checked_in) {
    return el(
      "div",
      { class: "card pad checkin-strip done" },
      el("div", { class: "grow" }, el("div", { class: "ci-title" }, t("aCheckedIn")), el("div", { class: "muted small" }, time)),
      el("span", { class: "tag done" }, t("aPts", { n: s.points }))
    );
  }

  const now = Date.now();
  const open = Date.parse(s.window_open_at);
  const close = Date.parse(s.window_close_at);
  const when = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

  let note;
  if (now < open) note = t("aOpensAt", { time: when(s.window_open_at) });
  else if (now > close) note = t("aClosesAt", { time: when(s.window_close_at) });
  else note = t("aCheckInLead");

  return el(
    "div",
    { class: "card pad checkin-strip" + (now >= open && now <= close ? " open" : "") },
    el(
      "div",
      { class: "grow" },
      el("div", { class: "ci-title" }, now >= open && now <= close ? t("aCheckIn") : t("aWindowShut")),
      el("div", { class: "muted small" }, note)
    ),
    el("span", { class: "tag " + (now >= open && now <= close ? "open" : "soon") }, t("aPts", { n: s.points }))
  );
}

/* ---------- the scanned code --------------------------------------------- */

/*
 * What the QR points at. By the time an athlete lands here they have already
 * done the only thing they need to do, so this screen asks nothing: it posts
 * the code and says what happened.
 */
SCREENS.c = function (args, user) {
  const box = el(
    "div",
    { class: "card pad stack" },
    el("h2", {}, t("aCheckingIn")),
    el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" }))
  );
  if (!user) return box; // render() has already sent them to log in

  API.post("/api/checkin", { session: args[0], slot: Number(args[1]), sig: args[2] })
    .then((r) => {
      box.textContent = "";
      // The noise the share button makes: the one on this site that means
      // "that went through". Nothing was clicked, so it is played by hand.
      SFX.share();
      box.append(
        el("div", { class: "landed" }, "🎉"),
        el("h2", {}, t("aWelcomeBack")),
        el("p", { class: "muted" }, r.session),
        el(
          "div",
          { class: "chips" },
          r.earned ? el("span", { class: "chip big" }, t("aEarned", { n: r.earned })) : null,
          r.bonus ? el("span", { class: "chip big" }, t("aStreakBonus", { n: r.bonus })) : null
        ),
        el("p", { class: "muted small" }, t("aStreakNow", { n: r.streak }) + " · " + t("aTotalNow", { n: r.total })),
        el("div", { class: "row-wrap" },
          el("button", { class: "btn primary", onclick: () => go("points") }, t("aSeePoints")),
          el("button", { class: "btn", onclick: () => go("week") }, t("aSeeWeek")))
      );
    })
    .catch((e) => {
      box.textContent = "";
      box.append(
        el("h2", {}, t("aCheckIn")),
        el("p", { class: "form-err" }, errorText(e)),
        el("div", { class: "row-wrap" }, el("button", { class: "btn", onclick: () => go("week") }, t("aSeeWeek")))
      );
    });

  return box;
};



/* ---------- the address, and the way back in ------------------------------ */

/* Both of these are opened from a mail app, which may be a browser that has
   never seen this site and has nobody logged in. So they are public routes
   and the token in the link is the whole proof. */

SCREENS.verify = function (args) {
  const box = el("div", { class: "card pad stack" }, el("h2", {}, t("aConfirming")),
    el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));

  API.post("/api/auth/verify", { token: args[0] })
    .then((r) => {
      // The link may have been opened in the browser they are logged into,
      // in which case the app now knows more than it did a moment ago.
      if (r.user) Auth.user = r.user;
      box.textContent = "";
      box.append(
        el("div", { class: "landed" }, "✅"),
        el("h2", {}, t("aConfirmed")),
        el("div", { class: "row-wrap" },
          el("button", { class: "btn primary", onclick: () => go(Auth.user ? "week" : "login") },
            Auth.user ? t("aSeeWeek") : t("aLogin")))
      );
    })
    .catch(() => {
      box.textContent = "";
      box.append(
        el("h2", {}, t("aConfirmEmail")),
        el("p", { class: "form-err" }, t("aConfirmBad")),
        el("div", { class: "row-wrap" },
          el("button", { class: "btn", onclick: () => go(Auth.user ? "me" : "login") }, t("aBackToLogin")))
      );
    });

  return box;
};

/* With no token this is the "send me a link" form; with one it is the
   "type the new password" form. One route, because they are one errand. */
SCREENS.reset = function (args) {
  return args[0] ? resetForm(args[0]) : resetRequestForm();
};

function resetRequestForm() {
  const email = el("input", { type: "email", id: "f-email", autocomplete: "username", inputmode: "email", required: true });
  const err = el("p", { class: "form-err hidden" });
  const ok = el("p", { class: "form-ok hidden" });
  const btn = el("button", { class: "btn primary lg block", type: "submit" }, t("aSendLink"));

  const form = el("form", {
    class: "stack",
    onsubmit: (e) => {
      e.preventDefault();
      ok.classList.add("hidden");
      submitting(btn, err, () =>
        API.post("/api/auth/reset/request", { email: email.value.trim() }).then(() => {
          ok.textContent = t("aResetSent");
          ok.classList.remove("hidden");
        })
      );
    },
  }, field("aEmail", email), err, ok, btn);

  return el("div", { class: "card pad stack" },
    el("h2", {}, t("aResetTitle")),
    el("p", { class: "muted small" }, t("aResetLead")),
    form,
    el("p", { class: "switch-link" }, el("a", { href: "#/login" }, t("aBackToLogin"))));
}

function resetForm(token) {
  const pw = el("input", { type: "password", id: "f-new", autocomplete: "new-password", minlength: 8, required: true });
  const err = el("p", { class: "form-err hidden" });
  const btn = el("button", { class: "btn primary lg block", type: "submit" }, t("aResetTitle"));
  const card = el("div", { class: "card pad stack" });

  const form = el("form", {
    class: "stack",
    onsubmit: (e) => {
      e.preventDefault();
      submitting(btn, err, () =>
        API.post("/api/auth/reset", { token: token, password: pw.value }).then(() => {
          card.textContent = "";
          card.append(
            el("div", { class: "landed" }, "✅"),
            el("h2", {}, t("aResetDone")),
            el("div", { class: "row-wrap" },
              el("button", { class: "btn primary", onclick: () => go("login") }, t("aLogin")))
          );
        })
      );
    },
  }, field("aNewPassword", pw, t("aPwHint")), err, btn);

  card.append(el("h2", {}, t("aResetTitle")), form,
    el("p", { class: "switch-link" }, el("a", { href: "#/login" }, t("aBackToLogin"))));
  return card;
}

/* The line asking an athlete to confirm their address — only once the club
   can actually send it, because otherwise it is a request nobody can act on. */
function confirmCard() {
  const err = el("p", { class: "form-err hidden" });
  const ok = el("p", { class: "form-ok hidden" });
  const btn = el("button", { class: "btn", type: "button" }, t("aSendLink"));
  btn.addEventListener("click", () => {
    ok.classList.add("hidden");
    submitting(btn, err, () =>
      API.post("/api/auth/verify/send", {}).then(() => {
        ok.textContent = t("aLinkSent");
        ok.classList.remove("hidden");
      })
    );
  });
  return el("div", { class: "card pad stack unconfirmed" },
    el("h3", {}, t("aConfirmEmail")),
    el("p", { class: "muted small" }, t("aConfirmLead")),
    err, ok,
    el("div", { class: "row" }, btn));
}

/* ---------- the feed ------------------------------------------------------ */

/* The coach's posts, and the article she has live, on one screen. Both are
   written in two languages; an athlete reads whichever theirs is, falling
   back to the other rather than to nothing — a notice in Arabic only is
   still a notice, and hiding it from an English reader helps nobody. */
SCREENS.feed = function () {
  const list = el("div", { class: "stack" }, el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));

  API.get("/api/feed")
    .then((d) => {
      list.textContent = "";
      if (d.tip) list.append(tipCard(d.tip));
      for (const p of d.posts) list.append(postCard(p));
      if (!d.posts.length && !d.tip) list.append(el("div", { class: "card pad" }, el("p", { class: "empty" }, t("aNoNews"))));
      if (d.whatsapp) {
        list.append(
          el(
            "a",
            { class: "btn block", href: d.whatsapp, target: "_blank", rel: "noopener noreferrer" },
            t("aWhatsapp")
          )
        );
      }
    })
    .catch((e) => {
      list.textContent = "";
      list.append(el("div", { class: "card pad" }, el("p", { class: "form-err" }, errorText(e))));
    });

  return list;
};

/** Whichever side the reader can read, theirs first. */
function side(obj, key) {
  const mine = I18N.lang === "ar" ? key + "_ar" : key + "_en";
  const other = I18N.lang === "ar" ? key + "_en" : key + "_ar";
  return obj[mine] || obj[other] || "";
}

/* The same paragraph and **bold** rules the tips use, from js/tipfmt.js, so
   the coach writes one way for both. */
function written(text) {
  const out = [];
  for (const b of tipBlocks(text)) {
    if (b.kind === "ul") {
      const ul = el("ul", { class: "post-ul" });
      for (const item of b.items) ul.append(el("li", {}, runs(item)));
      out.push(ul);
    } else out.push(el("p", {}, runs(b.text)));
  }
  return out;
}

function runs(text) {
  return tipRuns(text).map((r) => (r.bold ? el("b", {}, r.text) : document.createTextNode(r.text)));
}

function postCard(p) {
  const when = p.published_at ? new Date(p.published_at) : null;
  return el(
    "article",
    { class: "card pad stack post", dir: "auto" },
    el(
      "div",
      { class: "post-head" },
      p.pinned ? el("span", { class: "tag open" }, t("aPinned")) : null,
      when && !isNaN(when)
        ? el("span", { class: "muted small" }, when.toLocaleDateString(locale(), { day: "numeric", month: "long" }))
        : null
    ),
    el("h2", {}, side(p, "title")),
    el("div", { class: "post-body" }, written(side(p, "body")))
  );
}

/* The live article, shown here as well as beside the session — the same
   words, and the same byline the cloud carries. */
function tipCard(tip) {
  const s = (tip[I18N.lang] && tip[I18N.lang].title ? tip[I18N.lang] : tip.en.title ? tip.en : tip.ar) || {};
  if (!s.title && !s.body) return el("div");
  const ic = el("span", { class: "sign-ic", html: TIP_SIGN.icon });
  return el(
    "article",
    { class: "card pad stack post tip", dir: "auto" },
    el("div", { class: "post-head" }, el("span", { class: "cloud-kicker" }, t("aCoachTip"))),
    s.title ? el("h2", {}, s.title) : null,
    el("div", { class: "post-body" }, written(s.body)),
    el(
      "div",
      { class: "sign-wrap" },
      el("a", { class: "sign", href: TIP_SIGN.url, target: "_blank", rel: "noopener noreferrer" }, ic, el("span", {}, tipSignName(I18N.lang)))
    )
  );
}

/* ---------- points -------------------------------------------------------- */

const REASON_KEY = { checkin: "rCheckin", streak: "rStreak", adjust: "rAdjust", void: "rVoid" };

SCREENS.points = function () {
  const mine = el("div", { class: "card pad stack" }, el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));
  const board = el("div", { class: "card pad stack" }, el("h3", {}, t("aBoard")));
  const wrap = el("div", { class: "stack" }, mine, board);

  API.get("/api/points/me")
    .then((d) => {
      mine.textContent = "";
      mine.append(
        el("h2", {}, t("aYourPoints")),
        el(
          "div",
          { class: "tiles" },
          tile(d.total, t("aPoints")),
          tile(d.streak, t("aStreak")),
          tile(d.sessions, t("aSessionsCount"))
        )
      );
      if (!d.history.length) {
        mine.append(el("p", { class: "muted small" }, t("aNoPoints")));
        return;
      }
      mine.append(el("h3", {}, t("aHistory")));
      const rows = el("div", { class: "ledger" });
      for (const row of d.history) rows.append(ledgerRow(row));
      mine.append(rows);
    })
    .catch((e) => {
      mine.textContent = "";
      mine.append(el("p", { class: "form-err" }, errorText(e)));
    });

  API.get("/api/points/board")
    .then((d) => {
      board.textContent = "";
      board.append(el("h3", {}, t("aBoard")));
      if (!d.board.length) board.append(el("p", { class: "muted small" }, t("aBoardEmpty")));
      else {
        const list = el("div", { class: "board" });
        for (const r of d.board) {
          list.append(
            el(
              "div",
              { class: "board-row" + (r.me ? " me" : "") },
              el("span", { class: "place num" }, String(r.place)),
              el("span", { class: "who grow", dir: "auto" }, r.me ? t("aYouAre") : r.name),
              el("span", { class: "pts num" }, String(r.points))
            )
          );
        }
        board.append(list);
      }
      board.append(boardToggle(d.hidden));
    })
    .catch((e) => {
      board.append(el("p", { class: "form-err" }, errorText(e)));
    });

  return wrap;
};

const tile = (n, label) =>
  el("div", { class: "tile" }, el("div", { class: "n num" }, String(n)), el("div", { class: "l" }, label));

function ledgerRow(row) {
  const key = REASON_KEY[row.reason] || "rAdjust";
  const label =
    row.reason === "checkin"
      ? t("rCheckin", { n: row.delta, name: row.note || "" })
      : t(key);
  const when = new Date(row.at);
  return el(
    "div",
    { class: "ledger-row" },
    el("span", { class: "grow", dir: "auto" }, label),
    el("span", { class: "muted small" }, isNaN(when) ? "" : when.toLocaleDateString(locale(), { day: "numeric", month: "short" })),
    // dir, not an isolate: this one is built here rather than in the table,
    // and a signed number in an Arabic line reads backwards without it.
    el("span", { class: "delta num " + (row.delta < 0 ? "down" : "up"), dir: "ltr" }, (row.delta > 0 ? "+" : "") + row.delta)
  );
}

/** One tick: on the board, or not. Their own points never change either way. */
function boardToggle(hidden) {
  const box = el("input", { type: "checkbox", id: "on-board" });
  if (!hidden) box.setAttribute("checked", "");
  const note = el("p", { class: "muted small" }, hidden ? t("aBoardHiddenNote") : "");
  box.addEventListener("change", () => {
    box.disabled = true;
    API.post("/api/points/board-visibility", { hidden: !box.checked })
      .then((r) => {
        note.textContent = r.hidden ? t("aBoardHiddenNote") : "";
        toast(t("aSaved"));
      })
      .catch((e) => toast(errorText(e)))
      .finally(() => {
        box.disabled = false;
      });
  });
  return el("div", { class: "stack" }, el("label", { class: "sw", for: "on-board" }, box, el("span", {}, t("aOnBoard"))), note);
}

SCREENS.me = function (args, user) {
  /* name + language */
  const name = el("input", { type: "text", id: "f-name", value: user.name, maxlength: 40, autocomplete: "name" });
  const saveErr = el("p", { class: "form-err hidden" });
  const saveOk = el("p", { class: "form-ok hidden" });
  const saveBtn = el("button", { class: "btn primary", type: "submit" }, t("aSave"));
  const langSeg = el(
    "div",
    { class: "seg" },
    ["en", "ar"].map((l) =>
      el(
        "button",
        {
          type: "button",
          "aria-pressed": I18N.lang === l ? "true" : "false",
          onclick: () => {
            if (I18N.lang === l) return;
            I18N.apply(l);
            appBoot();
          },
        },
        l === "en" ? "English" : "العربية"
      )
    )
  );
  const profileForm = el(
    "form",
    {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        saveOk.classList.add("hidden");
        submitting(saveBtn, saveErr, () =>
          Auth.update({ name: name.value }).then(() => {
            saveOk.textContent = t("aSaved");
            saveOk.classList.remove("hidden");
            toast(t("aSaved"));
          })
        );
      },
    },
    field("aName", name),
    el("div", {}, el("label", {}, t("aEmail")), el("input", { type: "email", value: user.email, disabled: true }), el("p", { class: "hint" }, t("aEmailFixed"))),
    el("div", {}, el("label", {}, t("aLang")), langSeg),
    saveErr,
    saveOk,
    el("div", { class: "row" }, saveBtn)
  );

  /* password */
  const cur = el("input", { type: "password", id: "f-cur", autocomplete: "current-password", required: true });
  const next = el("input", { type: "password", id: "f-next", autocomplete: "new-password", minlength: 8, required: true });
  const pwErr = el("p", { class: "form-err hidden" });
  const pwBtn = el("button", { class: "btn", type: "submit" }, t("aChangePw"));
  const pwForm = el(
    "form",
    {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        submitting(pwBtn, pwErr, () =>
          API.post("/api/auth/password", { current: cur.value, next: next.value }).then(() => {
            cur.value = "";
            next.value = "";
            toast(t("aPwChanged"));
          })
        );
      },
    },
    field("aCurrentPw", cur),
    field("aNewPw", next, t("aPwHint")),
    pwErr,
    el("div", { class: "row" }, pwBtn)
  );

  const out = (everywhere) => () => Auth.logout(everywhere).then(() => go("login"));

  return el(
    "div",
    { class: "stack" },
    el(
      "div",
      { class: "card pad stack" },
      el("h2", {}, t("aHello", { name: user.name })),
      profileForm
    ),
    // Nothing is gated on this — signups are open and mail may never be
    // configured — so it asks once, here, where someone came to change
    // their own details anyway.
    Auth.club.email && !user.email_verified_at ? confirmCard() : null,
    el("div", { class: "card pad stack" }, el("h3", {}, t("aChangePw")), pwForm),
    el(
      "div",
      { class: "card pad stack" },
      el("div", { class: "row-wrap" }, el("button", { class: "btn", onclick: out(false) }, t("aLogout")), el("button", { class: "btn", onclick: out(true) }, t("aLogoutAll")))
    )
  );
};

/* Two arrows, drawn once. The week header mirrors them for Arabic. */
const ICON_PATH = {
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
};

/* ---------- go ------------------------------------------------------------ */

Theme.apply(Theme.saved());
I18N.apply(I18N.initial());
window.addEventListener("hashchange", render);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!Theme.saved()) render();
});
appBoot();
