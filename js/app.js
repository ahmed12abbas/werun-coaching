"use strict";

/* =========================================================================
   WE RUN Coaching — the athlete app (app.html).

   One page, hash routes:
     #/login  #/signup            anyone
     #/week   #/week/2026-09-07   the plan, one week at a time   (logged in)
     #/me                         name, language, password, log out

   Everything visible goes through t() in js/i18n.js. The header comes from
   brandBar() like the link page, and its language and theme toggles call
   appBoot() again, so there is one code path that draws the app.
   ========================================================================= */

/* ---------- routing ------------------------------------------------------ */

const PUBLIC_ROUTES = ["login", "signup"];

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

function render() {
  const app = $("#app");
  const r = parseRoute();
  const user = Auth.user;

  if (!user && !PUBLIC_ROUTES.includes(r.name)) return go("login");
  if (user && (PUBLIC_ROUTES.includes(r.name) || !r.name)) return go("week");

  app.textContent = "";
  document.title = "WE RUN Club";
  app.append(brandBar(null, appBoot));
  if (user) app.append(appNav(r.name));
  const screen = SCREENS[r.name] || SCREENS.week;
  app.append(screen(r.args, user));
}

function appNav(current) {
  const link = (name, label) =>
    el("a", { href: "#/" + name, "aria-current": current === name ? "page" : null }, label);
  return el("nav", { class: "appnav" }, link("week", t("navWeek")), link("me", t("navMe")));
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
        submitting(btn, err, () => Auth.login(email.value.trim(), pw.value).then(() => go("week")));
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
    el("p", { class: "switch-link" }, t("aNoAccount") + " ", el("a", { href: "#/signup" }, t("aSignup")))
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
        submitting(btn, err, () => Auth.signup(name.value, email.value.trim(), pw.value).then(() => go("week")));
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

/* Session detail arrives with phase 2; until then the week points back. */
SCREENS.session = function () {
  go("week");
  return el("div");
};

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
