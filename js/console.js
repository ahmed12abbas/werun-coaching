"use strict";

/* =========================================================================
   The coach's screens, the parts both of them need.

   Two pages sit on this: admin.html, which runs the club, and coach.html,
   which only shows what is happening — the head count, the code at the
   track, and who scanned it. There is no bundler here, so this is a plain
   script loaded before each page's own, and everything shares one global
   scope the way index.html's scripts do.

   Each page defines its own load(pw): renderLogin() calls it once the coach
   is through the door, and that is the only thing the two pages differ on
   at this level.

   Every string here goes through t(), the same table the athlete app uses.
   /coach draws in whichever language the reader picked; /admin pins English
   (it sets I18N.lang itself), because its own two thousand lines are English
   and half a translated page is worse than none.
   ========================================================================= */

var app = document.getElementById("app");

/* The password is only ever held here, in memory, for as long as this tab
   stays on the page. Nothing goes into storage, so a reload asks again --
   the right trade for a laptop a club shares. */
var password = null;

function el(tag, attrs) {
  var n = document.createElement(tag);
  attrs = attrs || {};
  for (var k in attrs) {
    if (k === "class") n.className = attrs[k];
    else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c == null) continue;
    if (Array.isArray(c)) { for (var j = 0; j < c.length; j++) if (c[j] != null) n.append(c[j]); }
    else n.append(c);
  }
  return n;
}

/* Every console call goes through here, so the coach's login and the club
   password are one decision made in one place rather than in nine. When a
   coach is logged in nothing sends a password at all; the browser carries the
   cookie and the Worker recognises it. */
/* One sentence per code the Worker sends, in the reader's language. Anything
   not in here is a code nobody wrote a sentence for, and says so with its
   number -- which is what a coach reads out over the phone. */
var SAYS = {
  "no-db": "cErrNoDb",
  "has-checkins": "cErrHasCheckins",
  "bad-password": "cErrBadPassword",
  "not-admin": "cErrNotAdmin",
  "no-column": "cErrNoColumn",
  "not-yourself": "cErrNotYourself",
  "too-often": "cErrTooOften",
  "qr-off": "cErrQrOff",
  "called-off": "cErrCalledOff",
  "not-configured": "cErrNotConfigured"
};

/* An Error that still says which code the Worker sent, so a caller can tell
   "nobody is logged in here yet" from "the database is missing". */
function coded(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

function api(route, payload) {
  var body = Object.assign({}, payload);
  if (password) body.password = password;
  return fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body)
  }).then(function (res) {
    return res.json()["catch"](function () { return {}; }).then(function (data) {
      if (res.ok) return data;
      var said = SAYS[data.error];
      if (said) throw coded(data.error, t(said));
      var err = new Error(t("cErrServer", { status: res.status, code: data.error || "?" }));
      err.code = data.error;
      throw err;
    });
  });
}

function renderLogin(message) {
  app.textContent = "";

  /* The coach's own account. */
  var email = el("input", { type: "email", autocomplete: "username", placeholder: "you@example.com" });
  var pw = el("input", { type: "password", autocomplete: "current-password", placeholder: t("cPassword"),
    onkeydown: function (e) { if (e.key === "Enter") signIn(); } });
  var signBtn = el("button", { class: "btn primary", onclick: function () { signIn(); } }, t("cSignIn"));
  var signErr = el("p", { class: "err", style: "display:none" });

  function signIn() {
    if (!email.value || !pw.value) return;
    signBtn.disabled = true;
    signErr.style.display = "none";
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email: email.value.trim(), password: pw.value })
    }).then(function (res) {
      return res.json()["catch"](function () { return {}; }).then(function (d) {
        if (!res.ok) throw new Error(d.error === "bad-login" ? t("cBadLogin")
          : d.error === "too-often" ? t("cErrTooOften")
          : t("cErrServer", { status: res.status, code: d.error || "?" }));
        // Coach or admin gets through the door here; which screens open
        // behind it is the Worker's call, not this form's.
        var staff = d.user && (d.user.role === "coach" || d.user.is_admin ||
          (d.user.is_admin === undefined && d.user.role === "coach"));
        if (!staff) {
          throw new Error(t("cNotStaff"));
        }
        return d;
      });
    }).then(function () {
      password = null; // the cookie is the credential from here on
      load(null)["catch"](function (e) { renderLogin(e.message); });
    })["catch"](function (e) {
      signBtn.disabled = false;
      signErr.textContent = e.message;
      signErr.style.display = "";
    });
  }

  /* The club password: the way in before there is a coach, and the way back
     in if the coach ever loses their account. */
  var input = el("input", {
    type: "password",
    autocomplete: "current-password",
    placeholder: t("cClubPassword"),
    onkeydown: function (e) { if (e.key === "Enter") go(); }
  });
  var btn = el("button", { class: "btn", onclick: function () { go(); } }, t("cUnlock"));

  function go() {
    if (!input.value) return;
    btn.disabled = true;
    load(input.value)["catch"](function (e) {
      renderLogin(e.message);
      var next = app.querySelector("input");
      if (next) next.focus();
    });
  }

  app.append(
    el("div", { class: "card" },
      el("div", { class: "ways" },
        el("div", { class: "way first" },
          el("h3", {}, t("cSignIn")),
          el("p", {}, t("cSignInLead")),
          el("div", { class: "row" },
            el("div", {}, el("label", {}, t("cEmail")), email),
            el("div", {}, el("label", {}, t("cPassword")), pw),
            el("div", { style: "flex:0 0 auto" }, signBtn)),
          signErr),
        el("div", { class: "way" },
          el("h3", {}, t("cOrClub")),
          el("p", {}, t("cOrClubLead")),
          el("div", { class: "row" },
            el("div", {}, el("label", {}, t("cClubPassword")), input),
            el("div", { style: "flex:0 0 auto" }, btn)))),
      message ? el("p", { class: "err" }, message) : null)
  );
  email.focus();
}

/*
 * First paint. The cookie is tried before the form is drawn: a coach who
 * tapped through from the app's Me screen is already logged in, and asking
 * for a password at the gate is the friction this page exists to remove.
 *
 * A refusal that is only "no password was sent" drops quietly to the form.
 * Anything else — no database, not an admin — is worth saying out loud.
 */
function consoleBoot() {
  app.textContent = "";
  app.append(el("p", { class: "muted small" }, t("cOpening")));
  load(null)["catch"](function (e) {
    renderLogin(e.code === "bad-password" || e.code === "not-configured" ? null : e.message);
  });
}

/* The reader's language, or their browser's when it is English: the club's
   English is not necessarily en-GB, and only Arabic needs saying. */
function consoleLocale() {
  return I18N.lang === "ar" ? "ar" : undefined;
}

function stamp(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(consoleLocale(), {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

/* ---- the code on the screen ----
   A fresh code every thirty seconds, drawn by js/qr.js rather than fetched,
   so it keeps working when the track has no signal to speak of. The bar
   underneath is the slot running out; the number is who has scanned so far,
   which is the thing a coach actually watches. */
function qrScreen(session) {
  var img = el("div", { class: "code" });
  var count = el("p", { class: "qr-count" }, "0");
  var sub = el("p", { class: "qr-sub" }, t("cScanIt"));
  var bar = el("i", {});
  var screen = el("div", { class: "qr-screen" },
    el("button", { class: "qr-close", onclick: close_ }, t("cDone")),
    el("h2", { class: "qr-name" }, session.name),
    img,
    el("div", { class: "qr-bar" }, bar),
    count, sub);

  var timer = null, tick = null, lock = null, dead = false;
  document.body.append(screen);
  // The coach is holding the phone up; letting it sleep mid-session is the
  // one failure that loses everybody's check-in.
  if (navigator.wakeLock && navigator.wakeLock.request) {
    navigator.wakeLock.request("screen").then(function (l) { lock = l; })["catch"](function () {});
  }

  function close_() {
    dead = true;
    clearTimeout(timer); clearInterval(tick);
    if (lock && lock.release) { try { lock.release(); } catch (e) {} }
    screen.remove();
  }
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close_(); document.removeEventListener("keydown", esc); }
  });

  function refresh() {
    if (dead) return;
    api("/api/admin/qr", { id: session.id }).then(function (d) {
      if (dead) return;
      img.innerHTML = qrSvg(d.url, "M");
      count.textContent = String(d.came || 0);
      sub.textContent = d.open ? t("cScanIt") : t("cCheckinShut");
      sub.className = "qr-sub" + (d.open ? "" : " qr-shut");

      // The bar empties over the life of the slot, and the next code is
      // fetched as it runs out.
      var left = Math.max(1, d.seconds);
      var span = 30;
      bar.style.transition = "none";
      bar.style.width = Math.round((left / span) * 100) + "%";
      clearInterval(tick);
      tick = setInterval(function () {
        left -= 1;
        bar.style.transition = "width .95s linear";
        bar.style.width = Math.max(0, Math.round((left / span) * 100)) + "%";
      }, 1000);
      timer = setTimeout(refresh, d.seconds * 1000 + 200);
    })["catch"](function (e) {
      if (dead) return;
      img.textContent = "";
      img.append(el("p", { class: "err" }, e.message));
      timer = setTimeout(refresh, 5000);
    });
  }
  refresh();
}

/* The light switch and the language switch, the same two the athlete app
   carries. Drawn here rather than borrowed from js/brand.js: that one wants
   the app's el(), which understands an `html` attribute this one does not,
   and two buttons are smaller than the difference.

   `rerender` is the page redrawing itself from what it already has: neither
   toggle refetches anything. */
function consoleTools(rerender) {
  var dark = Theme.current() === "dark";
  var moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>';
  var sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4' +
    'm11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';

  var light = el("button", {
    class: "tool",
    title: dark ? t("themeLight") : t("themeDark"),
    "aria-label": dark ? t("themeLight") : t("themeDark"),
    onclick: function () { Theme.toggle(); rerender(); }
  });
  light.innerHTML = dark ? sun : moon;

  var lang = el("button", {
    class: "tool text",
    title: t("langLabel"),
    "aria-label": t("langLabel"),
    onclick: function () { I18N.toggle(); rerender(); }
  }, t("langLabel"));

  return el("div", { class: "brand-tools" }, light, lang);
}

/* ---- the dashboard ----
   How many athletes came, per session and per week. Sessions are the unit a
   coach thinks in — "Tuesday had nineteen" — so the tiles are sessions and
   the number under the week is what they add up to. */

/* How many sessions a week shows by name before it stops naming them. */
var CHIPS = 8;

/** "Sun 31 Aug", the way a coach reads a date rather than 2026-08-31. */
function dayStamp(iso) {
  var d = new Date(String(iso) + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(consoleLocale(), { weekday: "short", day: "numeric", month: "short" });
}

/** "Sunday 6 September" — the heading a day of the week gets. */
function dayHeading(iso) {
  var d = new Date(String(iso) + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(consoleLocale(), { weekday: "long", day: "numeric", month: "long" });
}

/**
 * The two cards: this week session by session, and every week as a table.
 * Appended to `into`, so a page that has more to show can carry on below.
 */
function attendanceCards(into, weeks) {
  weeks = weeks || [];

  if (!weeks.length) {
    into.append(el("div", { class: "card" },
      el("h2", {}, t("cNoneYet")),
      el("p", { class: "muted small", style: "margin:0" }, t("cNoneYetLead"))));
    return;
  }

  // The server hands weeks newest first, and each week's sessions newest
  // first with them. On screen a week reads forwards: Sunday, then Monday.
  var inOrder = function (w) {
    return w.sessions.slice().sort(function (a, b) { return a.starts_at < b.starts_at ? -1 : 1; });
  };

  var latest = weeks[0];
  var tiles = el("div", { class: "tiles" });
  inOrder(latest).forEach(function (s) {
    tiles.append(el("div", { class: "tile" },
      el("div", { class: "n" }, String(s.came || 0)),
      el("div", { class: "l" }, s.name, el("small", {}, dayStamp(s.date)))));
  });
  // The week's own total last, so it reads as the sum of the row before it.
  tiles.append(el("div", { class: "tile" },
    el("div", { class: "n" }, String(latest.total)),
    el("div", { class: "l" }, t("cTheWeek"), el("small", {}, t("cCounted")))));

  into.append(el("div", { class: "card" },
    el("h2", {}, t("cThisWeek", { date: dayStamp(latest.start) })),
    tiles));

  var peak = Math.max.apply(null, weeks.map(function (w) { return w.total; }).concat(1));
  var rows = el("tbody", {});
  weeks.forEach(function (w) {
    rows.append(el("tr", {},
      el("td", { class: "wk" }, dayStamp(w.start),
        el("small", {}, t(w.sessions.length === 1 ? "cNSession" : "cNSessions", { n: w.sessions.length }))),
      // Enough sessions to see the shape of the week, not so many that a
      // fortnight of them turns the table into a wall.
      el("td", { class: "left", dir: "auto" },
        inOrder(w).slice(0, CHIPS).map(function (s) {
          return el("span", { class: "sess-chip" }, s.name + " " + (s.came || 0));
        }),
        w.sessions.length > CHIPS
          ? el("span", { class: "muted small" }, t("cMore", { n: w.sessions.length - CHIPS }))
          : null),
      el("td", { class: "tot" }, String(w.total)),
      el("td", { class: "barcell" },
        el("div", { class: "barwrap" },
          el("div", { class: "bar", style: "width:" + Math.round((w.total / peak) * 100) + "%" })))));
  });

  into.append(el("div", { class: "card" },
    el("h2", {}, t("cEveryWeek")),
    el("div", { class: "scroll" },
      el("table", {},
        el("thead", {}, el("tr", {},
          el("th", {}, t("cWeek")), el("th", { class: "left" }, t("cSessions")),
          el("th", {}, t("cAthletes")), el("th", { class: "barcell" }, ""))),
        rows))));
}
