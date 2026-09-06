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
      if (data.error === "no-db") throw new Error("No database is bound to the site yet -- run the bindings workflow (see the README).");
      if (data.error === "has-checkins") throw new Error("Athletes have checked in to that one. Void their check-ins first if you really mean to remove it.");
      if (data.error === "bad-password") throw new Error("That password is not right.");
      if (data.error === "too-often") throw new Error("Too many tries. Wait a minute.");
      if (data.error === "qr-off") throw new Error("QR_SECRET is not set on the site, so codes cannot be signed. See the README.");
      if (data.error === "called-off") throw new Error("That one is called off for this date. Put it back first if it is running after all.");
      if (data.error === "not-configured") throw new Error("No club password is set on the site yet. Set ADMIN_PASSWORD on the Pages project -- see the README.");
      throw new Error("The server answered " + res.status + " (" + (data.error || "?") + ").");
    });
  });
}

function renderLogin(message) {
  app.textContent = "";

  /* The coach's own account. */
  var email = el("input", { type: "email", autocomplete: "username", placeholder: "you@example.com" });
  var pw = el("input", { type: "password", autocomplete: "current-password", placeholder: "Password",
    onkeydown: function (e) { if (e.key === "Enter") signIn(); } });
  var signBtn = el("button", { class: "btn primary", onclick: function () { signIn(); } }, "Sign in");
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
        if (!res.ok) throw new Error(d.error === "bad-login" ? "Wrong email or password."
          : d.error === "too-often" ? "Too many tries. Wait a minute."
          : "The server answered " + res.status + ".");
        if (!d.user || d.user.role !== "coach") {
          throw new Error("That account is a member, not a coach. Unlock with the club password below and use Members to make it one.");
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
    placeholder: "Club password",
    onkeydown: function (e) { if (e.key === "Enter") go(); }
  });
  var btn = el("button", { class: "btn", onclick: function () { go(); } }, "Unlock");

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
          el("h3", {}, "Sign in"),
          el("p", {}, "With your coach account — the same login as the app."),
          el("div", { class: "row" },
            el("div", {}, el("label", {}, "Email"), email),
            el("div", {}, el("label", {}, "Password"), pw),
            el("div", { style: "flex:0 0 auto" }, signBtn)),
          signErr),
        el("div", { class: "way" },
          el("h3", {}, "Or the club password"),
          el("p", {}, "How the first coach gets in, and the way back if an account is lost."),
          el("div", { class: "row" },
            el("div", {}, el("label", {}, "Club password"), input),
            el("div", { style: "flex:0 0 auto" }, btn)))),
      message ? el("p", { class: "err" }, message) : null)
  );
  email.focus();
}

/* No locale passed: dates follow whoever is reading the dashboard. */
function stamp(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
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
  var sub = el("p", { class: "qr-sub" }, "Athletes scan this with their camera.");
  var bar = el("i", {});
  var screen = el("div", { class: "qr-screen" },
    el("button", { class: "qr-close", onclick: close_ }, "Done"),
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
      sub.textContent = d.open
        ? "Athletes scan this with their camera."
        : "Check-in is not open for this session right now.";
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
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The two cards: this week session by session, and every week as a table.
 * Appended to `into`, so a page that has more to show can carry on below.
 */
function attendanceCards(into, weeks) {
  weeks = weeks || [];

  if (!weeks.length) {
    into.append(el("div", { class: "card" },
      el("h2", {}, "Nobody has checked in yet"),
      el("p", { class: "muted small", style: "margin:0" },
        "This fills in the first time an athlete scans the code at the track.")));
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
    el("div", { class: "l" }, "The week", el("small", {}, "athletes counted"))));

  into.append(el("div", { class: "card" },
    el("h2", {}, "Athletes this week · from " + dayStamp(latest.start)),
    tiles));

  var peak = Math.max.apply(null, weeks.map(function (w) { return w.total; }).concat(1));
  var rows = el("tbody", {});
  weeks.forEach(function (w) {
    rows.append(el("tr", {},
      el("td", { class: "wk" }, dayStamp(w.start),
        el("small", {}, w.sessions.length + (w.sessions.length === 1 ? " session" : " sessions"))),
      // Enough sessions to see the shape of the week, not so many that a
      // fortnight of them turns the table into a wall.
      el("td", { class: "left", dir: "auto" },
        inOrder(w).slice(0, CHIPS).map(function (s) {
          return el("span", { class: "sess-chip" }, s.name + " " + (s.came || 0));
        }),
        w.sessions.length > CHIPS
          ? el("span", { class: "muted small" }, "+" + (w.sessions.length - CHIPS) + " more")
          : null),
      el("td", { class: "tot" }, String(w.total)),
      el("td", { class: "barcell" },
        el("div", { class: "barwrap" },
          el("div", { class: "bar", style: "width:" + Math.round((w.total / peak) * 100) + "%" })))));
  });

  into.append(el("div", { class: "card" },
    el("h2", {}, "Every week"),
    el("div", { class: "scroll" },
      el("table", {},
        el("thead", {}, el("tr", {},
          el("th", {}, "Week"), el("th", { class: "left" }, "Sessions"),
          el("th", {}, "Athletes"), el("th", { class: "barcell" }, ""))),
        rows))));
}
