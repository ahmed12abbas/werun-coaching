"use strict";

/* =========================================================================
   WE RUN Coaching — the athlete app (app.html).

   One page, hash routes:
     #/login  #/signup            anyone
     #/home                       where the app opens: this week against your
                                  goal, what you are down for, what is left
     #/week   #/week/2026-09-07   the plan, one week at a time   (logged in)
     #/plan/<slot>/<date>         one standing session, at a glance
     #/session/<id>               one session, in full
     #/c/<id>/<slot>/<sig>        what the coach's QR code points at
     #/points                     total, streak, history, the club board
     #/feed                       what the coach has written for the club
     #/verify/<token>             the link in the confirmation email
     #/reset  #/reset/<token>     ask for a new password, then set it
     #/store                      the club shop
     #/order/<id>                 where Stripe sends them back to
     #/me                         name, language, password, log out — normally
                                  opened as a sheet from the badge in the
                                  corner, and still its own address for the
                                  links that point at it

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

/** After a login, go where they were headed rather than to the home screen. */
function afterLogin() {
  const pending = takeCheckin();
  go(pending ? "c/" + pending : "home");
}

function goHomeFresh() {
  location.hash = "#/home";
  location.reload();
}

/* Where a route sends somebody instead of drawing, or null to draw it. */
function redirectFor(r, user) {
  if (!user) {
    // A code scanned by a stranger: keep it, then ask who they are.
    if (r.name === "c") {
      stashCheckin(r.args);
      return "login";
    }
    return PUBLIC_ROUTES.includes(r.name) ? null : "login";
  }
  // verify and reset are reachable logged in as well as out: an athlete who
  // is already signed in still clicks the link in their mail.
  return r.name === "login" || r.name === "signup" || !r.name ? "home" : null;
}

/* The mark goes home, and reloads on the way: one tap out of anything. */
function wireHomeMark(bar) {
  const mark = bar.querySelector(".brand-mark");
  if (!mark) return;
  mark.setAttribute("role", "button");
  mark.setAttribute("tabindex", "0");
  mark.setAttribute("title", t("navHome"));
  mark.addEventListener("click", goHomeFresh);
  mark.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHomeFresh(); }
  });
}

/* The mark in the middle, the badge in the corner it starts from — left in
   English, right in Arabic, because the row turns round with the page. It is
   prepended rather than passed as brandBar's trailing node so that the three
   of them (badge, mark, toggles) are the three columns `.appbar` lays out;
   the link page's own bar is untouched. Me is a sheet over whatever you were
   reading rather than a tab you leave the club to visit. Bar and tabs ride
   along at the top of the scroll, as one sticky block. */
function appTop(route, user) {
  const bar = brandBar(null, appBoot);
  if (user) {
    bar.classList.add("appbar");
    bar.prepend(meBadge(user));
  }
  wireHomeMark(bar);
  const top = el("div", { class: "apptop" }, bar);
  if (user) top.append(appNav(route));
  return top;
}

/* With the site down, the account screen still works — an athlete must be
   able to log out of a club that is mid-repair — and the coach sees
   everything, since she is the one doing the repairing. */
const siteDown = (route) => Auth.club.maintenance && !Auth.isCoach() && route !== "me";

function downCard() {
  return el(
    "div",
    { class: "card pad stack" },
    el("h2", {}, t("aDown")),
    el("p", { class: "muted" }, t("aDownLead"))
  );
}

function render() {
  const app = $("#app");
  const r = parseRoute();
  const user = Auth.user;

  const to = redirectFor(r, user);
  if (to) return go(to);

  app.textContent = "";
  // A new screen starts at its top: with the bar pinned there is nothing to
  // tell you the page changed if you stay halfway down the old one.
  window.scrollTo(0, 0);
  document.title = "WE RUN Club";
  closeMe();
  app.append(appTop(r.name, user));

  const banner = announcement();
  if (banner) app.append(banner);

  if (siteDown(r.name)) {
    app.append(downCard());
    appendFoot(app, r.name);
    return;
  }

  // hasOwn, not a bare lookup: "#/constructor" would otherwise find Object.
  const screen = Object.hasOwn(SCREENS, r.name) ? SCREENS[r.name] : SCREENS.home;
  app.append(screen(r.args, user));
  appendFoot(app, r.name);
}

/* The club's accounts, at the foot of every screen — the same row the share
   link ends on, so someone who has read their week has somewhere to go next.

   Not on the session screen: renderViewer already puts them under the rating
   box there, and a second row would only be the same five icons twice.

   Appended rather than returned, because this is the browser's own append and
   not el()'s: handed a null it writes the word "null" onto the page. */
function appendFoot(app, route) {
  if (route === "session") return;
  app.append(el("footer", {}, socialRow()));
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
  // "Week" rather than "This week" here: with five tabs on a phone the long
  // label is what pushes the row onto two lines.
  //
  // Me is not among them: it is the badge in the corner, because an account
  // screen is somewhere you dip into and come back from, and the tab it used
  // to hold is what the home screen has now.
  return el(
    "nav",
    { class: "appnav" },
    link("home", t("navHome")),
    link("week", t("navWeekShort")),
    link("feed", t("navFeed2")),
    link("points", t("navPointsShort")),
    // Only when there is a shop behind it.
    Auth.club.store ? link("store", t("navStore")) : null
  );
}

/* Who has scanned it, newest at the top: the coach is watching for the name
   that just went in, not reading from the beginning. A check-in the coach
   took back stays on the list, struck through — a name that quietly vanishes
   is a name they will go looking for again. */
function drawRoster(into, rows) {
  into.textContent = "";
  if (!rows.length) return into.append(el("p", { class: "muted small" }, t("cNobodyCame")));
  for (const r of rows.slice().reverse()) {
    const at = new Date(r.at);
    into.append(
      el(
        "div",
        { class: "qr-row" + (r.voided_at ? " off" : "") },
        el("span", { class: "grow", dir: "auto" }, r.name),
        el(
          "span",
          { class: "muted small num" },
          isNaN(at) ? "" : at.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
        ),
        // Taking one back is the club's, not every coach's: the route behind
        // it is admin-tier, so offering the button to a coach who cannot use
        // it would only be a refusal one tap later.
        r.voided_at || !Auth.isAdmin() ? null : voidButton(into, r)
      )
    );
  }
}

/* One check-in, taken back. The points go with it as a reversing row, which
   is the Worker's business; here it is a confirm, because the name beside
   the button is somebody who thinks they have their ten points. */
function voidButton(into, row) {
  const btn = el(
    "button",
    {
      class: "btn sm qr-void",
      type: "button",
      onclick: () => {
        if (!confirm(t("aVoidAsk", { name: row.name }))) return;
        btn.disabled = true;
        API.post("/api/admin/sessions", { action: "void", id: row.id })
          .then((d) => drawRoster(into, d.roster || []))
          .catch((e) => {
            btn.disabled = false;
            toast(errorText(e));
          });
      },
    },
    t("aVoid")
  );
  return btn;
}

/* ---------- reminders ------------------------------------------------------

   An hour before a session they are down for, on the phone in their pocket.
   The switch is the whole of it: saying yes asks the browser for permission,
   subscribes with the club's public key and hands the endpoint over; saying
   no takes the row back off. Nothing is remembered on this device — the
   browser's own subscription is the state, so a phone that was wiped or a
   permission that was revoked in Settings shows as off, which is the truth.
   ------------------------------------------------------------------------- */

/* The applicationServerKey the browser wants is bytes, not the base64url the
   club hands out. */
function keyBytes(base64url) {
  const pad = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(pad + "===".slice((pad.length + 3) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function remindCard() {
  // Not offered where it cannot work: iOS before 16.4, a private window, a
  // desktop browser with push switched off. An athlete meeting a switch that
  // does nothing is worse than not meeting one.
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return null;
  }
  const box = el("input", { type: "checkbox", id: "f-remind" });
  const note = el("p", { class: "muted small" }, t("aRemindHint"));
  const card = el(
    "div",
    { class: "card pad stack" },
    el("h3", {}, t("aRemind")),
    el("label", { class: "sw", for: "f-remind" }, box, el("span", {}, t("aRemindOn"))),
    note
  );

  // What the browser says is the state, not what the club last heard.
  navigator.serviceWorker.ready
    .then((reg) => reg.pushManager.getSubscription())
    .then((sub) => {
      box.checked = !!sub && Notification.permission === "granted";
    })
    .catch(() => {});

  box.addEventListener("change", () => {
    const wanted = box.checked;
    box.disabled = true;
    (wanted ? remindOn() : remindOff())
      .then(() => {
        note.textContent = t("aRemindHint");
        toast(t("aSaved"));
      })
      .catch((e) => {
        box.checked = !wanted;
        note.textContent = errorText(e);
      })
      .finally(() => {
        box.disabled = false;
      });
  });
  return card;
}

async function remindOn() {
  // The key first: a club with no VAPID secrets answers push-off, and asking
  // for permission before finding that out spends the one prompt a browser
  // gives you on nothing.
  const d = await API.post("/api/push", { action: "key" });
  if (Notification.permission !== "granted") {
    const asked = await Notification.requestPermission();
    if (asked !== "granted") throw new Error("push-refused");
  }
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(d.key) }));
  await API.post("/api/push", { action: "subscribe", endpoint: sub.endpoint });
}

async function remindOff() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  // The club is told first: a browser that has already forgotten the
  // subscription cannot tell us which endpoint to drop.
  await API.post("/api/push", { action: "unsubscribe", endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

/* ---------- the badge in the corner, and what it opens -------------------- */

/** Their own face, top corner, opposite the logo. Opens the Me sheet. */
function meBadge(user) {
  return el(
    "button",
    { class: "me-badge", type: "button", title: t("navMe"), "aria-label": t("navMe"), onclick: openMe },
    avatarNode(user.avatar, user.name, "sm")
  );
}

/* One sheet, up from the bottom, over the page rather than instead of it.

   Two things ride in it: the Me screen — the very same node SCREENS.me builds,
   because a second copy of the account screen kept in step by hand is the
   thing that goes wrong — and a runner's card, tapped off the club board.
   The #/me route stays, for links that point at it and for maintenance, where
   an athlete must be able to log out of a club that is mid-repair. */
let meSheet = null;

function closeMe() {
  if (!meSheet) return;
  meSheet.remove();
  document.removeEventListener("keydown", meKey);
  meSheet = null;
}

const meKey = (e) => {
  if (e.key === "Escape") closeMe();
};

/** Whatever the sheet is holding this time, under the grip and a Close. */
function openSheet(label, body) {
  closeMe();
  const card = el(
    "div",
    { class: "sheet-card", role: "dialog", "aria-modal": "true", "aria-label": label },
    el(
      "div",
      { class: "sheet-head" },
      el("span", { class: "sheet-grip", "aria-hidden": "true" }),
      el("button", { class: "btn sm", type: "button", onclick: closeMe }, t("aClose"))
    ),
    body
  );
  meSheet = el("div", { class: "sheet", onclick: (e) => { if (e.target === meSheet) closeMe(); } }, card);
  document.body.append(meSheet);
  document.addEventListener("keydown", meKey);
  return card;
}

/* The badge in the corner opens the same card a board row does — one card for
   a runner, whether the club tapped it or you did — with the account screen a
   button away. The two numbers are not on the account, so the card goes up
   with them blank and fills them in when the board answers: a tap that waits
   on the network before anything moves reads as a tap that missed. */
function openMe() {
  const user = Auth.user;
  if (!user) return go("login");
  if (meSheet) return closeMe(); // a second tap on the badge puts it away
  const card = openRunner({
    me: true,
    name: user.name,
    avatar: user.avatar,
    bio: user.bio,
    instagram: user.instagram,
    place: "—",
    points: "—",
  });
  const tiles = card.querySelector(".tiles");
  API.get("/api/points/board")
    .then((d) => {
      // Off the board by choice still has a place and a total; the row is only
      // the shorter way to them.
      const row = (d.board || []).find((x) => x.me) || d.mine || {};
      tiles.replaceWith(el("div", { class: "tiles" }, tile(row.place || "—", t("aPlace")), tile(row.points || 0, t("aPoints"))));
    })
    .catch(() => {}); // the card is still their card without the numbers
}

/* Their Instagram, beside their name, when they have one and have left it
   showing. The club's own icon set already carries the glyph, and the link is
   built here rather than stored, so what the database holds stays a handle. */
function igLink(handle) {
  if (!handle) return null;
  const ig = SOCIAL.find((s) => s.id === "instagram");
  return el("a", {
    class: "social ig-btn",
    href: "https://instagram.com/" + encodeURIComponent(handle),
    target: "_blank",
    rel: "noopener noreferrer",
    title: "@" + handle,
    "aria-label": "@" + handle,
    html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + ig.svg + "</svg>",
  });
}

/* One runner, as the club sees them: their face, their line, where they stand
   and what they have. Their own card carries the way into the account screen;
   somebody else's carries nothing to press, because a board row is a name and
   a number and this is the whole of what the club may know. */
function openRunner(r) {
  return openSheet(
    r.me ? t("navMe") : r.name,
    el(
      "div",
      { class: "card pad stack runner" },
      el(
        "div",
        { class: "runner-head" },
        avatarNode(r.avatar, r.name, "lg"),
        el(
          "div",
          { class: "grow" },
          el("div", { class: "runner-name" }, el("h2", { dir: "auto" }, r.name), igLink(r.instagram)),
          r.bio ? el("p", { class: "muted", dir: "auto" }, r.bio) : null
        )
      ),
      el("div", { class: "tiles" }, tile(r.place, t("aPlace")), tile(r.points, t("aPoints"))),
      r.me
        ? el(
            "button",
            { class: "btn primary block", type: "button", onclick: () => openSheet(t("navMe"), SCREENS.me([], Auth.user)) },
            t("aSettings")
          )
        : null
    )
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

/* Sunday, not Monday: the club runs Sunday to Thursday and rests on Friday,
   so a Monday-first week would cut its weekend in half. */
function weekStartOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localISO(d);
}


/* Who is running. Both are optional — someone who would rather not say still
   runs with the club, and a join form that refuses them is one that loses
   them. The year, not the date: it gives the age group a race entry is set
   by, and the club has no use for the day. */
function genderSelect(value) {
  const sel = el("select", { id: "f-gender" });
  // Blank is "rather not say" — there is no second option meaning the same
  // thing, because offering it twice only asks the reader which of two
  // identical answers they meant.
  for (const [v, key] of [["", "aGenderOther"], ["woman", "aWoman"], ["man", "aMan"]]) {
    sel.append(el("option", { value: v }, t(key)));
  }
  // A member who answered "other" before keeps it, without it being offered.
  if (value === "other") sel.append(el("option", { value: "other" }, t("aGenderOther")));
  sel.value = value || "";
  return sel;
}

/* The form asks for an age, because that is the number a runner knows about
   themselves; the database keeps the birth year, because an age written down
   is wrong from the next birthday on and nobody ever comes back to correct
   it. The two meet here and nowhere else. */
const thisYear = () => new Date().getFullYear();
const ageOf = (birthYear) => (birthYear ? thisYear() - birthYear : null);
const yearOfAge = (age) => {
  const n = Math.round(Number(String(age).trim()));
  return String(age).trim() === "" || !Number.isFinite(n) ? "" : String(thisYear() - n);
};

function ageInput(birthYear) {
  // The same window the Worker allows, said in the other unit: 5 to 100.
  const input = el("input", {
    type: "number", id: "f-age", inputmode: "numeric",
    min: "5", max: "100", step: "1", placeholder: "30",
  });
  const age = ageOf(birthYear);
  if (age) input.value = String(age);
  return input;
}

/** The first letter of a name, for a member who has not picked a face. */
const initialOf = (name) => (String(name || "").trim()[0] || "?").toUpperCase();

/** One badge: their avatar if they chose one, their initial if they did not. */
function avatarNode(id, name, size) {
  const box = el("span", { class: "avatar" + (size ? " " + size : "") });
  if (id && Avatars.has(id)) box.innerHTML = Avatars.svg(id);
  else box.append(el("span", { class: "letter" }, initialOf(name)));
  return box;
}

/**
 * Twelve faces and a way out of them.
 *
 * The pick rides on the profile form rather than saving on the tap, so trying
 * them all costs one write and a stray tap costs none. Hands back the node
 * and a reader for what is selected.
 *
 * `beside` is what sits to the right of the chosen face — the bio. The twelve
 * tiles below say what an avatar is better than the sentence that used to be
 * there, so the space went to the one thing an athlete had no way to say.
 */
function avatarPicker(user, beside) {
  let chosen = Avatars.has(user.avatar) ? user.avatar : "";
  const face = el("span", { class: "avatar lg" });
  const opts = [];

  function paint() {
    face.textContent = "";
    if (chosen) face.innerHTML = Avatars.svg(chosen);
    else face.append(el("span", { class: "letter" }, initialOf(user.name)));
    for (const [id, btn] of opts) btn.setAttribute("aria-pressed", id === chosen ? "true" : "false");
  }

  const opt = (id, cls, kid) => {
    // The drawings carry no words of their own, so the name is the button's.
    const said = Avatars.NAME[id] ? t(Avatars.NAME[id]) : null;
    const btn = el(
      "button",
      { type: "button", class: cls, title: said, "aria-label": said,
        onclick: () => { chosen = id; paint(); } },
      kid
    );
    opts.push([id, btn]);
    return btn;
  };

  const node = el(
    "div",
    { class: "stack" },
    el("div", { class: "row avrow-me" }, face, el("div", { class: "grow" }, beside)),
    el("div", { class: "avpick" }, Avatars.GROUPS.map((g) =>
      el("div", { class: "avgroup" },
        el("span", { class: "avlabel" }, t(g.label)),
        el("div", { class: "avrow" }, g.ids.map((id) => opt(id, "avopt", avatarNode(id, "", null))))))),
    opt("", "btn sm avnone", t("aAvNone"))
  );

  paint();
  return { node: node, value: () => chosen };
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
  const gender = genderSelect("");
  const age = ageInput(null);
  const err = el("p", { class: "form-err hidden" });
  const btn = el("button", { class: "btn primary lg block", type: "submit" }, t("aSignup"));
  const form = el(
    "form",
    {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        submitting(btn, err, () =>
          Auth.signup(name.value, email.value.trim(), pw.value, {
            gender: gender.value,
            birth_year: yearOfAge(age.value),
          }).then(afterLogin)
        );
      },
    },
    field("aName", name),
    field("aEmail", email),
    field("aPassword", pw, t("aPwHint")),
    el("div", { class: "row" }, el("div", {}, el("label", { for: "f-gender" }, t("aGender")), gender),
      el("div", {}, el("label", { for: "f-age" }, t("aAge")), age)),
    el("p", { class: "hint" }, t("aBirthHint")),
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

/* ---------- home ----------------------------------------------------------

   Where the app opens, and the three questions an athlete has on a Tuesday
   morning, in the order they have them: how am I doing this week, what am I
   down for, and what is left that I could still join.

   One request. /api/week already merges the standing pattern, the changes,
   the published sessions, whether this athlete checked in and now whether
   they have put their name down — so the home screen is that week read three
   ways rather than three endpoints of its own.
   ------------------------------------------------------------------------- */

SCREENS.home = function (args, user) {
  const start = localISO(weekStartOf(new Date()));
  const today = localISO(new Date());
  const box = el(
    "div",
    { class: "stack" },
    el("div", { class: "card pad" }, el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })))
  );

  API.get("/api/week?start=" + start)
    .then((data) => {
      const week = weekSoFar(data.days, today);
      box.textContent = "";
      box.append(
        goalCard(week.done, user),
        homeList("aMySessions", week.ahead.filter((x) => x.it.registered), "aNoneDown"),
        homeList("aOpenSessions", week.ahead.filter((x) => !x.it.registered), "aNoneOpen")
      );
      lightCoachCode(box, data.days);
      startCountdowns();
    })
    .catch((e) => {
      box.textContent = "";
      box.append(el("div", { class: "card pad" }, el("p", { class: "form-err" }, errorText(e))));
    });

  return box;
};

/* The week read two ways: how many sessions they have checked in to, and
   what is still ahead of them to join or turn up for. */
function weekSoFar(days, today) {
  // Not called off, not on a day already gone, and not this morning's session
  // two hours after it started — that is behind them however much of today
  // is left.
  const stillToCome = (it, date) => {
    if (it.cancelled || date < today) return false;
    const shuts = closesTime(it, date);
    return shuts === null || Date.now() <= shuts;
  };
  let done = 0;
  const ahead = [];
  for (const d of days || []) {
    for (const it of d.items || []) {
      if (it.checked_in) done++;
      if (stillToCome(it, d.date)) ahead.push({ it: it, date: d.date });
    }
  }
  return { done: done, ahead: ahead };
}

/* Sessions run against sessions meant. The pips rather than a bar, because
   three of five is a thing you count at a glance and 60% is not; a week that
   went past the goal grows a pip rather than overflowing. */
function goalCard(done, user) {
  const goal = Math.max(1, Number(user.week_goal) || 3);
  const pips = el("div", { class: "pips" });
  for (let i = 0; i < Math.max(goal, done); i++) pips.append(el("span", { class: "pip" + (i < done ? " on" : "") }));
  return el(
    "div",
    { class: "card pad stack" },
    el(
      "div",
      { class: "goal-head" },
      el("h2", { class: "grow" }, t("aThisWeek")),
      // Two numbers and a slash read backwards in an Arabic line otherwise.
      el("span", { class: "goal-n num", dir: "ltr" }, done + " / " + goal)
    ),
    pips,
    el(
      "div",
      { class: "goal-foot" },
      el("p", { class: "muted small grow" }, done >= goal ? t("aGoalHit") : t("aGoalLeft", { n: goal - done })),
      coachCodeButton()
    )
  );
}

/* The coach's way to the track screen, on the screen they open on.

   It lights up when a session they put themselves down for is the one lighting
   up in the week — the same quarter-hour window every hot row answers from —
   so the coach standing at the track finds the code lit. Every other coach has
   the same button, unlit: any of them can hand out a code, only one of them is
   there. Not offered to athletes at all. */
function coachCodeButton() {
  if (!Auth.isCoach()) return null;
  return el("button", { class: "btn sm code-btn", type: "button", onclick: openCode }, t("aWeekCode"));
}

/* Which of this coach's own ticks the button should burn for: the first one
   whose window has not shut yet. The ticker does the rest, so a button drawn
   an hour early lights itself when the hour comes.

   The rota arrived after the code that reads it and its table may not be
   there yet, so a refusal here leaves an ordinary button rather than no
   button — see lib/weekplan.js for the same shape. */
function lightCoachCode(root, days) {
  const btn = root.querySelector(".code-btn");
  if (!btn || !Auth.user) return;

  // The club's next session is what the button opens until the rota names a
  // better answer, so a coach standing in for somebody still has a code to
  // hand out.
  const ahead = sessionsAhead(days);
  CODE_TARGET = ahead[0] || null;

  API.post("/api/coach/rota", { action: "list" })
    .then((d) => armForTick(btn, ahead, d))
    .catch(() => {});
}

/* Everything still to come this week, soonest first. */
function sessionsAhead(days) {
  const ahead = [];
  for (const day of days || []) {
    for (const it of day.items || []) {
      const next = stillAhead(it, day.date);
      if (next) ahead.push(next);
    }
  }
  return ahead.sort((a, b) => a.from - b.from);
}

/* One session with its window, unless it is called off or already shut. */
function stillAhead(it, date) {
  if (it.cancelled) return null;
  const from = startsAt(it, date);
  const till = closesTime(it, date);
  if (!from || till === null || Date.now() > till) return null;
  return { it: it, date: date, from: from, till: till };
}

/* The first session this coach has ticked on the rota, lit on the button. */
function armForTick(btn, ahead, d) {
  const mine = new Set(
    (d.rota || []).filter((r) => r.user_id === Auth.user.id).map((r) => r.schedule_id + "|" + r.date)
  );
  const ticked = ahead.find((x) => x.it.schedule_id && mine.has(x.it.schedule_id + "|" + x.date));
  if (!ticked) return;
  CODE_TARGET = ticked;
  btn.dataset.hot = ticked.from.getTime() + "," + ticked.till;
  markHot(btn);
  startCountdowns();
}

/* ---------- the code, in the app ------------------------------------------

   What /coach does for the whole week, for the one session the button is
   armed for: a fresh signature every thirty seconds, drawn here by js/qr.js
   rather than fetched as an image, and the count of who has scanned it. The
   coach is already holding this phone; walking them to another page to hold
   it up was one tap too many.
   ------------------------------------------------------------------------- */

/* Which session the button opens: the one this coach is down for, or failing
   that the club's next. Set when the home screen draws. */
let CODE_TARGET = null;

function openCode() {
  const target = CODE_TARGET;
  if (!target) return toast(t("aNoCode"));
  const box = el(
    "div",
    { class: "card pad stack qr-card" },
    el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" }))
  );
  openSheet(t("aWeekCode"), box);

  // A standing slot has no session row until somebody asks for a code, which
  // is what this is: find-or-create, the same call the console makes.
  const session =
    target.it.kind === "session" && target.it.id
      ? Promise.resolve(target.it.id)
      : API.post("/api/admin/sessions", {
          action: "open",
          schedule_id: target.it.schedule_id,
          date: target.date,
        }).then((d) => d.session.id);

  session
    .then((id) => codeLoop(box, id, target.date))
    .catch((e) => {
      box.textContent = "";
      box.append(el("p", { class: "form-err" }, errorText(e)));
    });
}

/* A new code every thirty seconds until the sheet goes away. The sheet being
   off the page is the stop signal — there is one sheet and closing it is the
   only way out — and the screen is held awake while it is up, because a phone
   that sleeps mid-session is the one failure that loses everybody's check-in. */
function codeLoop(box, id, date) {
  const name = el("h2", { dir: "auto" });
  // Which morning this code is for, under the name it is for: two sessions
  // in a week carry the same title, and the one on the screen has to say
  // which of them the coach is holding up.
  const day = new Date(date + "T00:00:00");
  const when = el(
    "p",
    { class: "qr-when" },
    isNaN(day)
      ? ""
      : day.toLocaleDateString(locale(), { weekday: "short" }) +
        " " +
        day.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" })
  );
  const code = el("div", { class: "qr-code" });
  const came = el("p", { class: "qr-came num" });
  const note = el("p", { class: "muted small" });
  const who = el("div", { class: "qr-who" });
  box.textContent = "";
  box.append(name, when, code, came, note, el("h3", {}, t("cWhoCame")), who);

  let lock = null;
  if (navigator.wakeLock && navigator.wakeLock.request) {
    navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
  }
  const stop = () => {
    if (lock && lock.release) { try { lock.release(); } catch (e) {} }
    lock = null;
  };

  const tick = () => {
    if (!box.isConnected) return stop();
    API.post("/api/admin/qr", { id: id })
      .then((d) => {
        if (!box.isConnected) return stop();
        name.textContent = d.name || "";
        code.innerHTML = qrSvg(d.url, "M");
        came.textContent = t("cCame", { n: d.came || 0 });
        note.textContent = d.open ? t("cScanIt") : t("cCheckinShut");
        // Names on the same beat as the code: the count above already says how
        // many, and the coach ticking people off wants to read who.
        API.post("/api/admin/sessions", { action: "roster", id: id })
          .then((r) => {
            if (box.isConnected) drawRoster(who, r.roster || []);
          })
          .catch(() => {}); // the code is the point; the list can miss a beat
        setTimeout(tick, (d.seconds || 30) * 1000 + 200);
      })
      .catch((e) => {
        if (!box.isConnected) return stop();
        code.textContent = "";
        note.textContent = errorText(e);
        setTimeout(tick, 5000);
      });
  };
  tick();
}

function homeList(titleKey, rows, emptyKey) {
  return el(
    "div",
    { class: "card pad stack" },
    el("h3", {}, t(titleKey)),
    rows.length ? el("div", { class: "hrows" }, rows.map(homeRow)) : el("p", { class: "empty" }, t(emptyKey))
  );
}

/** The way in to whatever a row is: a workout, or a standing slot's summary. */
const openItem = (item, date) =>
  go(item.kind === "session" ? "session/" + item.id : "plan/" + item.schedule_id + "/" + date);

function homeRow(x) {
  const it = x.it;
  const day = new Date(x.date + "T00:00:00");
  const place = side(it, "place");
  const what = side(it, "desc");

  // No coach name here. The home screen is the athlete's own three lines —
  // where, what it is worth, how long until it starts — and who is taking it
  // is the same name on nearly every row of the week; it is on the session's
  // own card a tap away, where it means something.
  const meta = el(
    "div",
    { class: "slot-meta" },
    place ? el("span", { class: "place" }, place) : null,
    el("span", {}, t("aPts", { n: it.points }))
  );
  const soon = countdownPill(it, x.date);
  if (soon) meta.append(soon);

  return el(
    "div",
    { class: "hrow" },
    el(
      "div",
      { class: "hrow-when" },
      el("span", { class: "wd" }, day.toLocaleDateString(locale(), { weekday: "short" })),
      el("span", { class: "num" }, prettyTime(it, x.date))
    ),
    el(
      "div",
      { class: "grow" },
      el("button", { class: "hrow-title", type: "button", onclick: () => openItem(it, x.date) }, side(it, "title")),
      what ? el("div", { class: "slot-desc", dir: "auto" }, what) : null,
      meta
    ),
    homeActions(x)
  );
}

/* What you can do about a row, from where you stand: nothing once you have
   scanned, the code and a way out once you are down for it, and otherwise
   the one tap that puts you down. */
function homeActions(x) {
  const it = x.it;
  if (it.checked_in) return el("span", { class: "tag done" }, t("aCheckedIn"));

  if (!it.registered) return el("div", { class: "hrow-do" }, signupButton(x, true));

  const opens = opensTime(it, x.date);
  const shuts = closesTime(it, x.date);
  const live = opens !== null && shuts !== null && Date.now() >= opens && Date.now() <= shuts;
  return el(
    "div",
    { class: "hrow-do" },
    // The same scan the session screen offers, off until the code is live —
    // the Worker refuses a code outside the window either way.
    el(
      "button",
      {
        class: "btn sm primary",
        type: "button",
        disabled: !live,
        onclick: () => Scan.open((c) => go("c/" + c.session + "/" + c.slot + "/" + c.sig)),
      },
      t("aCheckIn")
    ),
    signupButton(x, false)
  );
}

/* Putting a name down, and taking it off again. Nothing to offer on a session
   the coach opened outside the standing week: it has no slot to sign against,
   and turning up to it was never something you said in advance. */
function signupButton(x, on) {
  if (!x.it.schedule_id) return null;
  const btn = el("button", { class: "btn sm" + (on ? " primary" : ""), type: "button" }, t(on ? "aRegister" : "aCancelReg"));
  btn.addEventListener("click", () => saveSignup(btn, x.it.schedule_id, x.date, on));
  return btn;
}

/* The one write behind every one of these buttons. Redraws the screen from
   the server rather than patching the row it was tapped on: the home screen
   moves it between two lists and a session card changes shape, and both are
   the same answer read again. */
function saveSignup(node, scheduleId, date, on) {
  node.disabled = true;
  API.post("/api/signups", { action: on ? "join" : "leave", schedule_id: scheduleId, date: date })
    .then(() => {
      toast(t(on ? "aRegistered" : "aCancelled"));
      render();
    })
    .catch((e) => {
      toast(errorText(e));
      node.disabled = false;
    });
}

/* The same choice, in the corner of a session's own card: "I'm coming", and
   your own face once you are. It writes the row the home screen writes, so
   the two can never disagree — and tapping the face takes the name off.
   Nothing to offer on a session called off, or on one the coach opened
   outside the standing week, which has no slot to sign against. */
function signupControl(item, date) {
  if (!item.schedule_id || item.cancelled) return null;
  const on = !item.registered;
  const node = item.registered
    ? el(
        "button",
        { class: "signup-on", type: "button", title: t("aCancelReg"), "aria-label": t("aCancelReg") },
        avatarNode(Auth.user.avatar, Auth.user.name, "sm")
      )
    : el("button", { class: "btn sm primary", type: "button" }, t("aRegister"));
  node.addEventListener("click", () => saveSignup(node, item.schedule_id, date, on));
  return node;
}

/* The week: seven cards, Monday first, the coach's sessions on the days
   they happen. Today is outlined; a session is a button into its detail. */
SCREENS.week = function (args) {
  const today = localISO(new Date());
  const thisWeek = localISO(weekStartOf(new Date()));
  const start = /^\d{4}-\d{2}-\d{2}$/.test(args[0] || "") ? localISO(weekStartOf(new Date(args[0] + "T00:00:00"))) : thisWeek;

  // icon() hands back markup, so it goes in through `html` rather than as text.
  const arrow = (dir) => el("span", { style: "display:inline-flex", html: icon(dir < 0 ? ICON_PATH.left : ICON_PATH.right) });
  const head = el(
    "div",
    { class: "week-head" },
    el("button", { class: "btn icon", "aria-label": t("aPrevWeek"), onclick: () => go("week/" + addDays(start, -7)) }, arrow(-1)),
    el("h2", {}, start === thisWeek ? t("aThisWeek") : t("aWeekOf", { date: shortDate(start) })),
    el("button", { class: "btn icon", "aria-label": t("aNextWeek"), onclick: () => go("week/" + addDays(start, 7)) }, arrow(1))
  );
  const list = el("div", { class: "days" }, el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));
  const card = el("div", { class: "card pad stack" }, head, list);

  API.get("/api/week?start=" + start)
    .then((data) => {
      list.textContent = "";
      const any = data.days.some((d) => d.items && d.items.length);
      for (const d of data.days) list.append(dayCard(d, today));
      if (!any) list.append(el("p", { class: "empty" }, t("aNothingWeek")));
      startCountdowns();
    })
    .catch((e) => {
      list.textContent = "";
      list.append(el("p", { class: "form-err" }, errorText(e)));
    });
  return card;
};

function longDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
}

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
  const cls = "day" + (d.date === today ? " today" : "");
  const items = d.items || [];
  if (!items.length) {
    return el("div", { class: cls }, when, el("div", { class: "day-body" }, el("div", { class: "day-rest" }, t("aRestDay"))));
  }
  return el("div", { class: cls }, when, el("div", { class: "day-body slots" }, items.map((it) => slotRow(it, d.date))));
}

/* One thing on one day, and always a way in: a published workout opens the
   whole session, a standing one opens its summary. Only a session called off
   stays flat, because there is nothing left to say about it. */
function slotRow(item, date) {
  const meta = slotMeta(item, side(item, "place"));
  // What the session is, under the name. The title says which session this
  // is and this says what it asks of you — "45min + strides" — so a reader
  // scanning the week can tell Sunday's easy 45 from Saturday's long 80
  // without opening either.
  const what = side(item, "desc");
  const note = side(item, "note");

  const body = el(
    "div",
    { class: "grow" },
    el("div", { class: "slot-title" }, side(item, "title")),
    what ? el("div", { class: "slot-desc", dir: "auto" }, what) : null,
    meta,
    note ? el("div", { class: "slot-note" }, note) : null
  );

  const clock = el("div", { class: "slot-at num" }, prettyTime(item, date));
  const tag = slotTag(item, date);
  // Not on one that has been called off: there is nothing to count down to.
  const soon = item.cancelled ? null : countdownPill(item, date);
  if (soon) meta.append(soon);

  const node = slotNode(item, date, clock, body, tag);
  lightWhenLive(node, item, date);
  return node;
}

/* The line under the title: where, what it is worth, and who has it. */
function slotMeta(item, place) {
  const meta = el("div", { class: "slot-meta" });
  if (place) {
    meta.append(
      item.map_url
        ? el("a", { class: "place", href: item.map_url, target: "_blank", rel: "noopener noreferrer",
                    title: t("aOpenMap"), onclick: (e) => e.stopPropagation() }, place)
        : el("span", { class: "place" }, place)
    );
  }
  if (item.kind === "session") meta.append(el("span", {}, t("aPts", { n: item.points })));
  // Who is taking it, when it has been said. Most slots have the same coach
  // every week, and a row that repeats the name four times down one day is
  // noise — so this is left off until somebody fills it in.
  if (item.coach) meta.append(el("span", { class: "who", dir: "auto" }, t("aWithCoach", { name: item.coach })));
  return meta;
}

/* The row itself: a published workout opens the session, a standing one its
   summary, and one called off opens nothing. */
function slotNode(item, date, ...parts) {
  if (item.kind === "session") {
    return el("button", { class: "slot open", type: "button", onclick: () => go("session/" + item.id) }, ...parts);
  }
  if (item.cancelled) return el("div", { class: "slot off" }, ...parts);
  return el("button", { class: "slot", type: "button", onclick: () => go("plan/" + item.schedule_id + "/" + date) },
    ...parts);
}

/* Lit from a quarter of an hour out until check-in shuts. On a phone held at
   the track the row you want is the one glowing, and it is the same window
   the check-in tag is already answering from. */
function lightWhenLive(node, item, date) {
  if (item.cancelled) return;
  const from = startsAt(item, date);
  const till = closesTime(item, date);
  if (!from || till === null) return;
  node.dataset.hot = from.getTime() + "," + till;
  markHot(node);
}

/* The glow on or off, from the window written on the row. Fifteen minutes,
   because that is when people are arriving, not when they are deciding. */
const HOT_BEFORE = 15 * 60000;
function markHot(node) {
  const at = String(node.dataset.hot).split(",");
  const now = Date.now();
  node.classList.toggle("hot", now >= Number(at[0]) - HOT_BEFORE && now <= Number(at[1]));
}

/* ---------- one standing session -----------------------------------------

   What the week row cannot hold: the whole place, what it is worth, how long
   until it starts, and the way in at the track. The slots the coach has
   published a workout for skip this and open the workout itself.
   ------------------------------------------------------------------------- */

SCREENS.plan = function (args) {
  const id = String(args[0] || "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(args[1] || "") ? args[1] : localISO(new Date());
  const box = el("div", { class: "stack" }, el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));

  // The week the day belongs to: /api/week is the one endpoint that merges
  // the pattern, the changes and the published sessions, and a second way of
  // resolving a single day would be a second answer waiting to disagree.
  API.get("/api/week?start=" + localISO(weekStartOf(new Date(date + "T00:00:00"))))
    .then((data) => {
      const day = (data.days || []).find((d) => d.date === date);
      const item = day && (day.items || []).find((it) => String(it.schedule_id) === id);
      box.textContent = "";
      if (!item) return box.append(el("div", { class: "card pad" }, el("p", { class: "empty" }, t("aNoSuchSlot"))));
      // Published between the week screen and this one: the workout says more.
      if (item.kind === "session") return go("session/" + item.id);
      box.append(planCard(item, date));
      startCountdowns();
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

/* The facts every session has, whether or not it carries a workout: the
   place — tappable when the coach has dropped a pin on it — what the session
   is, and the points. */
function whereAndWorth(item) {
  const facts = el("div", { class: "plan-facts" });
  const place = side(item, "place");
  if (place) {
    facts.append(
      el(
        "div",
        {},
        el("span", { class: "l" }, t("aWhere")),
        item.map_url
          ? el("a", { class: "place", href: item.map_url, target: "_blank", rel: "noopener noreferrer", title: t("aOpenMap") }, place)
          : el("span", {}, place)
      )
    );
  }
  // What it is, in a line: "80 min easy on the trail". The coach writes it
  // once on the standing slot and every session published into that slot
  // carries it, so nothing shows here until somebody has written one.
  const what = side(item, "desc");
  if (what) {
    facts.append(el("div", {}, el("span", { class: "l" }, t("aDetails")), el("span", { dir: "auto" }, what)));
  }
  if (item.coach) {
    facts.append(el("div", {}, el("span", { class: "l" }, t("aCoach")), el("span", { dir: "auto" }, item.coach)));
  }
  facts.append(el("div", {}, el("span", { class: "l" }, t("aWorth")), el("span", {}, t("aPts", { n: item.points }))));
  return facts;
}

function planCard(item, date) {
  const soon = item.cancelled ? null : countdownPill(item, date);
  const note = side(item, "note");
  return el(
    "div",
    { class: "card pad stack" },
    planHead(item, date),
    planWhen(item, date),
    soon,
    whereAndWorth(item),
    note ? el("p", { class: "slot-note" }, note) : null,
    stepsLink(item),
    joinParts(item, date)
  );
}

/* The title, whether this one occurrence is off or has moved, and the
   control for putting your name down. */
function planHead(item, date) {
  return el("div", { class: "plan-head" }, el("h2", {}, side(item, "title")), planTag(item), signupControl(item, date));
}

function planTag(item) {
  if (item.cancelled) return el("span", { class: "tag miss" }, t("aCalledOff"));
  if (item.moved) return el("span", { class: "tag open" }, t("aChanged"));
  return null;
}

function planWhen(item, date) {
  const day = new Date(date + "T00:00:00");
  return el(
    "div",
    { class: "plan-when" },
    el("span", { class: "num" }, prettyTime(item, date)),
    el("span", { class: "muted" }, day.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }))
  );
}

/* The steps the coach has for this slot on some other date. The club runs the
   same speed session three times a week, so the workout is nearly always the
   one an athlete came for — say plainly which date it is from rather than let
   them read it as this one's. Steps stay on a session that has been called
   off, where Join does not: there is no code to scan for a session nobody is
   holding, but the workout is still a workout and an athlete may well go and
   run it alone. */
function stepsLink(item) {
  if (!item.steps_id) return [];
  return [
    el("p", { class: "muted small" }, t("aStepsLead", { date: longDate(item.steps_date) })),
    el(
      "button",
      { class: "btn block", type: "button", onclick: () => go("session/" + item.steps_id) },
      t("aSteps")
    ),
  ];
}

/* Join, and the line under it. Yesterday's session is over: check-in shut two
   hours after it started, and a live button on it is an invitation to scan a
   code that no longer exists. Called off is called off for the same reason —
   there is no code to scan for a session nobody is holding. Before it opens
   is as dead as after it shuts — the Worker refuses both — so the button says
   so rather than sending an athlete at a code that will be turned away. */
function joinParts(item, date) {
  if (item.cancelled) return [];
  const opens = opensTime(item, date);
  const early = opens !== null && Date.now() < opens;
  const shut = checkinShut(item, date) || early;
  return [joinButton(shut), el("p", { class: "hint" }, joinHint(item, date, opens, early, shut))];
}

function joinHint(item, date, opens, early, shut) {
  if (early) {
    return t("aOpensAt", { time: new Date(opens).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) });
  }
  if (shut) return t("aClosedAt", { time: closesAt(item, date) });
  return t("aScanLead");
}

/* A published session with no steps behind it: the same four facts the
   week's summary gives, and no pretence that a workout is coming. */
function noStepsCard(s) {
  const at = new Date(s.starts_at);
  return el(
    "div",
    { class: "card pad stack" },
    el("div", { class: "plan-head" }, el("h2", { dir: "auto" }, s.name)),
    el(
      "div",
      { class: "plan-when" },
      el("span", { class: "num" }, isNaN(at) ? "" : at.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })),
      el("span", { class: "muted" }, longDate(s.date))
    ),
    whereAndWorth(s)
  );
}

/* The way in at the track. The coach holds up the code; this reads it with
   the phone's own camera and hands the result to the very same #/c/ route the
   camera app would have followed, so nothing about check-in itself changes.

   Off only where the window is known to be shut — on a standing slot it stays
   live, because the coach may have published the session since this page was
   drawn and the code carries its own id either way. */
/* Down to the workout. The check-in card says "tap Steps" and until now
   there was no Steps to tap — the card is already on the page, so this
   only takes the athlete to it. It glows because on a session with steps
   it is the second thing worth doing after joining. */
function stepsButton() {
  const btn = el(
    "button",
    {
      class: "btn block steps-btn",
      type: "button",
      "aria-expanded": "false",
      "aria-controls": "stepsWrap",
      // Its own two sounds, opening and closing, so the document listener
      // does not put a click on top of the pop.
      "data-sfx": "off",
      onclick: () => {
        const wrap = document.getElementById("stepsWrap");
        if (!wrap) return;
        const open = wrap.hidden;
        wrap.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.classList.toggle("on", open);
        if (open) {
          SFX.pop();
          wrap.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          SFX.unpop();
          btn.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      },
    },
    t("aSteps")
  );
  return btn;
}

function joinButton(off) {
  return el(
    "button",
    {
      class: "btn primary lg block",
      type: "button",
      disabled: !!off,
      onclick: () => Scan.open((c) => go("c/" + c.session + "/" + c.slot + "/" + c.sig)),
    },
    t("aJoin")
  );
}

/* A standing session carries a wall-clock time; a published one carries a
   real instant, which is the one to trust. */
function prettyTime(item, date) {
  if (item.starts_at) {
    const at = new Date(item.starts_at);
    if (!isNaN(at)) return at.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  }
  const at = new Date(date + "T" + item.at + ":00");
  return isNaN(at) ? item.at : at.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

function slotTag(item, date) {
  if (item.kind === "standing") {
    if (item.cancelled) return el("span", { class: "tag miss" }, t("aCalledOff"));
    if (item.moved) return el("span", { class: "tag open" }, t("aChanged"));
    // A slot the coach has not published a workout for is still a session
    // with a code at the track, so it says when that code is live — the same
    // window a published one is answering from, and "upcoming" before it, so
    // a row without a published workout does not read as the one dead line in
    // the week. Still nothing after: "missed" on every past standing slot
    // would paint half the week red.
    const from = opensTime(item, date);
    const till = closesTime(item, date);
    if (from === null || till === null) return null;
    const now = Date.now();
    if (now >= from && now <= till) return el("span", { class: "tag open" }, t("aOpenNow"));
    if (now < from) return el("span", { class: "tag soon" }, t("aUpcoming"));
    return null;
  }
  return statusTag(item);
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
      // A session the coach opened only to hand out a code carries no
      // workout. There is nothing to decode and nothing broken about it — it
      // says what it is, where, and what it is worth, like the week's summary.
      if (!s.payload) {
        box.append(noStepsCard(s));
        return;
      }
      let w = null;
      try {
        w = decodeWorkout(s.payload);
      } catch (e) {
        box.append(el("div", { class: "card pad" }, el("p", { class: "form-err" }, t("brokenLead"))));
        return;
      }
      // The date and the name the coach published it under, not whatever the
      // link carried. One workout can be published to several slots — the club
      // runs the same speed session three times a week — and a page headed
      // "Monday | WeRUN" on a Thursday is the link's name outliving its use.
      w.date = s.date;
      if (s.name) w.name = s.name;
      // Folded away until the Steps button asks for it: an athlete standing
      // at the track wants the code, not twenty-seven steps, and the ones
      // who want the steps say so.
      const wrap = el("div", { id: "stepsWrap", class: "stack", hidden: true });
      box.append(wrap);
      renderViewer(wrap, w, appBoot, { chrome: false });
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
  // The workout draws its own screen below this strip and says nothing about
  // who is taking the session, so this is the only place left to say it.
  const who = s.coach ? t("aWithCoach", { name: s.coach }) : "";

  const soon = countdownPill({ starts_at: s.starts_at }, s.date);
  if (soon) setTimeout(startCountdowns, 0);

  // What the session is — "80min", "45min easy + strides" — the coach line off
  // the standing slot. A session that carries a workout has only this strip
  // above it, and the timeline below says how to run the thing without ever
  // saying what it is. A session with no steps prints the same line among its
  // own facts, so saying it here too would say it twice. Only one of the two
  // cards below is ever built, so the node is safe to share between them.
  const what = s.payload ? side(s, "desc") : "";
  const whatLine = what ? el("div", { class: "ci-what", dir: "auto" }, what) : null;

  if (s.checked_in) return checkedInCard(s, who ? time + " · " + who : time, whatLine);
  return windowCard(s, who, whatLine, soon);
}

/* Checked in with the run still ahead: the steps stay. The card said to tap
   Steps a second ago, and scanning must not take the button away. */
function checkedInCard(s, line, whatLine) {
  return el(
    "div",
    { class: "card pad stack" },
    el(
      "div",
      { class: "checkin-strip done" },
      el("div", { class: "grow" }, el("div", { class: "ci-title" }, t("aCheckedIn")),
        el("div", { class: "muted small", dir: "auto" }, line),
        whatLine),
      el("span", { class: "tag done" }, t("aPts", { n: s.points }))
    ),
    s.payload ? stepsButton() : null
  );
}

/* When it opens, when it shut, or to scan now. */
function windowNote(s, now, open, close) {
  const when = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (now < open) return t("aOpensAt", { time: when(s.window_open_at) });
  if (now > close) return t("aClosedAt", { time: when(s.window_close_at) });
  return t("aCheckInLead");
}

/* Not checked in yet: the window, the way to scan, and the steps. */
function windowCard(s, who, whatLine, soon) {
  const now = Date.now();
  const open = Date.parse(s.window_open_at);
  const close = Date.parse(s.window_close_at);
  const note = windowNote(s, now, open, close);
  const live = now >= open && now <= close;
  return el(
    "div",
    { class: "card pad stack checkin-card" + (live ? " open" : "") },
    el(
      "div",
      { class: "checkin-strip" },
      el(
        "div",
        { class: "grow" },
        el("div", { class: "ci-title" }, live ? t("aCheckIn") : t("aWindowShut")),
        el("div", { class: "muted small", dir: "auto" }, who ? note + " · " + who : note),
        whatLine,
        soon
      ),
      el(
        "div",
        { class: "ci-side" },
        el("span", { class: "tag " + (live ? "open" : "soon") }, t("aPts", { n: s.points })),
        signupControl(s, s.date)
      )
    ),
    joinButton(!live),
    s.payload ? stepsButton() : null
  );
}

/* ---------- the scanned code --------------------------------------------- */

/*
 * What the QR points at. By the time an athlete lands here they have already
 * done the only thing they need to do, so this screen asks nothing: it posts
 * the code and says what happened.
 */
/**
 * Three shells over the check-in card. Canvas rather than a pile of divs:
 * ninety sparks each moving every frame is one draw call here and ninety
 * style recalculations there. It takes no clicks, cleans itself up when the
 * last spark has fallen, and does nothing at all for an athlete who has
 * asked for less movement.
 */
function fireworks() {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const cv = el('canvas', { class: 'fireworks', 'aria-hidden': 'true' });
  cv.width = innerWidth * 2;
  cv.height = innerHeight * 2;
  document.body.append(cv);

  const g = cv.getContext('2d');
  const colours = ['#8851f4', '#f5b841', '#ffffff', '#c7a4ff', '#ff7ab8'];
  const bits = [];
  const shell = (x, y, n) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 4.2;
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2,
        life: 1, fade: 0.008 + Math.random() * 0.012, r: 1.4 + Math.random() * 2.4,
        c: colours[(Math.random() * colours.length) | 0] });
    }
  };
  shell(cv.width * 0.5, cv.height * 0.34, 70);
  setTimeout(() => shell(cv.width * 0.26, cv.height * 0.26, 45), 170);
  setTimeout(() => shell(cv.width * 0.75, cv.height * 0.3, 45), 300);

  const born = performance.now();
  (function frame() {
    g.clearRect(0, 0, cv.width, cv.height);
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.x += b.vx; b.y += b.vy; b.vy += 0.075; b.vx *= 0.992; b.life -= b.fade;
      if (b.life <= 0) { bits.splice(i, 1); continue; }
      g.globalAlpha = b.life;
      g.fillStyle = b.c;
      g.beginPath();
      g.arc(b.x, b.y, b.r * b.life + 0.4, 0, 6.284);
      g.fill();
    }
    g.globalAlpha = 1;
    // The two later shells have not been fired yet on the first few frames,
    // so an empty list is only the end after they have been.
    if (bits.length || performance.now() - born < 500) requestAnimationFrame(frame);
    else cv.remove();
  })();
}

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
      SFX.checkin();
      fireworks();
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



/* ---------- how long until it starts -------------------------------------

   Eight hours out, a session starts counting down. That is the window where
   it is worth knowing — the evening session while you are at work, the
   morning one before you go to bed — and outside it a countdown is noise on
   every row of the week.

   One ticker for the whole screen rather than one per row: it redraws the
   text in place, so a week with fourteen sessions still has one timer.
   ------------------------------------------------------------------------- */

const COUNTDOWN_FROM = 8 * 3600 * 1000;
let countdownTicker = null;

/** When a slot actually starts, as an instant on the reader's clock. */
function startsAt(item, date) {
  if (item.starts_at) {
    const at = new Date(item.starts_at);
    if (!isNaN(at)) return at;
  }
  const at = new Date(date + "T" + item.at + ":00");
  return isNaN(at) ? null : at;
}

/* When check-in shuts, as an instant.

   A published session carries one outright. A standing slot carries the club's
   rule instead — a wall-clock "04:55" is not an instant until somebody says
   which day and whose clock, and that is this page, not the Worker. */
const SHUTS_AFTER = 120 * 60000; // only if the week did not say
const OPENS_BEFORE = 60 * 60000; // ditto

/** When check-in opens, as an instant — the mirror of closesTime(). */
function opensTime(item, date) {
  if (item.window_open_at) {
    const at = Date.parse(item.window_open_at);
    if (Number.isFinite(at)) return at;
  }
  const when = startsAt(item, date);
  if (!when) return null;
  const before = Number(item.window_before_min);
  return when.getTime() - (Number.isFinite(before) ? before * 60000 : OPENS_BEFORE);
}

function closesTime(item, date) {
  if (item.window_close_at) {
    const at = Date.parse(item.window_close_at);
    if (Number.isFinite(at)) return at;
  }
  const when = startsAt(item, date);
  if (!when) return null;
  const after = Number(item.window_after_min);
  return when.getTime() + (Number.isFinite(after) ? after * 60000 : SHUTS_AFTER);
}

/** Is this one over — too late to scan anything? */
function checkinShut(item, date) {
  const close = closesTime(item, date);
  return close !== null && Date.now() > close;
}

/** The hour it shut, for the line that says so. */
function closesAt(item, date) {
  const close = closesTime(item, date);
  return close === null
    ? ""
    : new Date(close).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

/** "in 7h 20m", "in 45 min", or "starting now" once it is under way. */
function countdownText(when) {
  const left = when.getTime() - Date.now();
  if (left <= 0) return t("aStartingNow");
  const mins = Math.floor(left / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return t("aStartsIn", { t: h ? t("aHrsMins", { h: h, m: m }) : t("aMins", { m: Math.max(1, m) }) });
}

/**
 * A pill that counts down, or nothing at all when the start is further off
 * than the window — or already well past, when the check-in tag says more.
 */
function countdownPill(item, date) {
  const when = startsAt(item, date);
  if (!when) return null;
  const left = when.getTime() - Date.now();
  if (left > COUNTDOWN_FROM || left < -30 * 60000) return null;

  const pill = el("span", { class: "countdown" + (left <= 0 ? " now" : "") }, countdownText(when));
  pill.dataset.at = String(when.getTime());
  return pill;
}

/* Every thirty seconds: enough for a countdown measured in minutes, and
   little enough that a phone left on the week screen is not kept awake by
   it. Cleared whenever the screen is redrawn so they never stack up. */
function startCountdowns() {
  clearInterval(countdownTicker);
  countdownTicker = setInterval(() => {
    const pills = document.querySelectorAll(".countdown");
    const hot = document.querySelectorAll("[data-hot]");
    if (!pills.length && !hot.length) return clearInterval(countdownTicker);
    for (const node of hot) markHot(node);
    for (const pill of pills) {
      const when = new Date(Number(pill.dataset.at));
      pill.textContent = countdownText(when);
      pill.classList.toggle("now", when.getTime() - Date.now() <= 0);
    }
  }, 30000);
}

/* ---------- the shop ------------------------------------------------------ */

/* Pay here, collect at the track. The card itself is handled entirely by
   Stripe on a page of its own — this screen's whole job is to pick a thing
   and a size and then get out of the way. */

/** Smallest units to something a person reads, in their own language. */
function money(amount, currency) {
  try {
    return new Intl.NumberFormat(locale(), { style: "currency", currency: (currency || "usd").toUpperCase() })
      .format(amount / 100);
  } catch (e) {
    // An unknown currency code should not take the price off the page.
    return (amount / 100).toFixed(2) + " " + String(currency || "").toUpperCase();
  }
}

SCREENS.store = function () {
  const list = el("div", { class: "stack" }, el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));

  API.get("/api/store")
    .then((d) => {
      list.textContent = "";
      list.append(el("div", { class: "card pad stack" },
        el("h2", {}, t("aStore")),
        el("p", { class: "muted small" }, d.open ? t("aStoreLead") : t("aStoreShut"))));

      if (d.open) {
        for (const p of d.products) list.append(productCard(p, d.currency));
        if (!d.products.length) list.append(el("div", { class: "card pad" }, el("p", { class: "empty" }, t("aStoreEmpty"))));
      }
      if (d.orders.length) list.append(myOrders(d.orders));
    })
    .catch((e) => {
      list.textContent = "";
      list.append(el("div", { class: "card pad" }, el("p", { class: "form-err" }, errorText(e))));
    });

  return list;
};

function productCard(p, currency) {
  const err = el("p", { class: "form-err hidden" });
  let picked = p.options.length === 1 ? p.options[0] : "";
  const sizes = sizePicker(p.options, picked, (size) => {
    picked = size;
  });

  const qty = el("select", { class: "qty" });
  for (let n = 1; n <= 5; n++) qty.append(el("option", { value: String(n) }, String(n)));

  const buy = el("button", { class: "btn primary lg block" }, t("aBuy"));
  buy.addEventListener("click", () => {
    submitting(buy, err, () =>
      API.post("/api/store/checkout", { product: p.id, variant: picked, qty: Number(qty.value) }).then((r) => {
        buy.textContent = t("aTaking");
        // Stripe's own page, on Stripe's own domain. Nothing about the card
        // ever passes through this site.
        location.href = r.url;
      })
    );
  });

  return el(
    "article",
    { class: "card pad stack product" + (p.sold_out ? " gone" : ""), dir: "auto" },
    el("div", { class: "post-head" },
      el("h3", { class: "grow" }, side(p, "name")),
      el("span", { class: "price num" }, money(p.price, currency))),
    side(p, "desc") ? el("p", { class: "muted small" }, side(p, "desc")) : null,
    p.low ? el("p", { class: "few" }, t("aFewLeft", { n: p.low })) : null,
    buyArea(p, sizes, qty, err, buy)
  );
}

/* One button per size; pressing one picks it and lets go of the others. */
function sizePicker(options, picked, onPick) {
  const sizes = el("div", { class: "seg sizes" });
  for (const size of options) {
    const b = el("button", { type: "button", "aria-pressed": picked === size ? "true" : "false" }, size);
    b.addEventListener("click", () => {
      onPick(size);
      for (const other of sizes.children) other.setAttribute("aria-pressed", other === b ? "true" : "false");
    });
    sizes.append(b);
  }
  return sizes;
}

/* Sold out says so; otherwise the size, how many, and the button. */
function buyArea(p, sizes, qty, err, buy) {
  if (p.sold_out) return el("p", { class: "muted" }, t("aSoldOut"));
  return el("div", { class: "stack" },
    p.options.length ? el("div", {}, el("label", {}, t("aSize")), sizes) : null,
    el("div", { class: "row" },
      el("div", { style: "flex:0 0 92px" }, el("label", {}, t("aQty")), qty)),
    err,
    buy);
}

const ORDER_STATE = { paid: "aOrderPaid", handed: "aOrderHanded", pending: "aOrderPending", cancelled: "aOrderCancelled" };

/* "Tee · M × 2": the product, the size when there is one, and how many when
   it is more than one. */
const orderLabel = (o) => o.name + (o.variant ? " · " + o.variant : "") + (o.qty > 1 ? " × " + o.qty : "");

function myOrders(orders) {
  const box = el("div", { class: "card pad stack" }, el("h3", {}, t("aMyOrders")));
  for (const o of orders) {
    box.append(
      el("div", { class: "order-row" },
        el("span", { class: "grow", dir: "auto" }, orderLabel(o)),
        el("span", { class: "muted small" }, money(o.amount, o.currency)),
        el("span", { class: "tag " + (o.status === "handed" ? "done" : o.status === "paid" ? "open" : "soon") },
          t(ORDER_STATE[o.status] || "aOrderPending")))
    );
  }
  return box;
}

/* What the order page says once the order has settled: thanks for one that
   is paid for, otherwise where it stands. The parts it has nothing to say
   for are null, and go through filter(Boolean) on the way to the browser's
   own append — which, unlike el(), would write them out as the word "null". */
function orderView(o) {
  const done = o.status === "paid" || o.status === "handed";
  return [
    done ? el("div", { class: "landed" }, "🎉") : null,
    el("h2", {}, done ? t("aOrderThanks") : t(ORDER_STATE[o.status] || "aOrderPending")),
    el("p", { class: "muted" }, orderLabel(o)),
    el("p", { class: "muted small" }, money(o.amount, o.currency)),
    done ? el("p", {}, t("aOrderThanksLead")) : null,
    el("div", { class: "row-wrap" },
      el("button", { class: "btn primary", onclick: () => go("store") }, t("aBackToStore"))),
  ];
}

/* Where Stripe sends them back to. The webhook may not have landed yet, so a
   pending order is an ordinary answer here and the page keeps looking. */
SCREENS.order = function (args) {
  const box = el("div", { class: "card pad stack" }, el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));
  let tries = 0;

  function look() {
    API.get("/api/store/order?id=" + encodeURIComponent(args[0] || ""))
      .then((d) => {
        const o = d.order;
        // Still pending: ask again for about half a minute, then leave the
        // page saying so rather than spinning at them forever.
        if (o.status === "pending" && tries < 10) {
          tries++;
          box.textContent = "";
          box.append(el("h2", {}, t("aOrderPending")), el("p", { class: "muted small" }, t("aOrderWaiting")),
            el("div", { class: "row", style: "justify-content:center" }, el("span", { class: "spin" })));
          setTimeout(look, 3000);
          return;
        }
        box.textContent = "";
        box.append(...orderView(o).filter(Boolean));
      })
      .catch((e) => {
        box.textContent = "";
        box.append(el("p", { class: "form-err" }, errorText(e)),
          el("div", { class: "row-wrap" }, el("button", { class: "btn", onclick: () => go("store") }, t("aBackToStore"))));
      });
  }
  look();
  return box;
};

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
      const tips = d.tips || [];
      FEED_FACES = { counts: d.reactions || {}, mine: d.my_reactions || {} };
      for (const tip of tips) list.append(tipCard(tip));
      for (const p of d.posts) list.append(postCard(p));
      if (!d.posts.length && !tips.length) list.append(el("div", { class: "card pad" }, el("p", { class: "empty" }, t("aNoNews"))));
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

/* The day a thing went up, in the reader's own calendar. The year only when
   it is not this one: a notice from last Tuesday does not need "2026" on it,
   and an article from last winter does. */
function published(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return null;
  const how = { day: "numeric", month: "long" };
  if (d.getFullYear() !== new Date().getFullYear()) how.year = "numeric";
  return el("span", { class: "muted small" }, d.toLocaleDateString(locale(), how));
}

function postCard(p) {
  return reactable(
    "post:" + p.id,
    el(
      "article",
      { class: "card pad stack post", dir: "auto" },
      el(
        "div",
        { class: "post-head" },
        p.pinned ? el("span", { class: "tag open" }, t("aPinned")) : null,
        published(p.published_at)
      ),
      el("h2", {}, side(p, "title")),
      el("div", { class: "post-body" }, written(side(p, "body")))
    )
  );
}

/* ---------- reactions ------------------------------------------------------

   A double tap on a card opens three faces; one of them sticks, in the corner
   of the card, with how many other people chose it. Tapping your own again
   takes it back. Double tap rather than a button because the faces are not
   what the news screen is for — they are what you do when something lands.
   ------------------------------------------------------------------------- */

const FACES = ["👍", "💜", "🔥"];
let FEED_FACES = { counts: {}, mine: {} };

/** The card, with its own corner of faces and the gesture that opens them. */
function reactable(target, card) {
  const corner = el("div", { class: "reacts" });
  const draw = () => {
    corner.textContent = "";
    const counts = FEED_FACES.counts[target] || {};
    const mine = FEED_FACES.mine[target] || null;
    for (const face of FACES) {
      if (!counts[face]) continue;
      corner.append(
        el(
          "button",
          {
            class: "react" + (mine === face ? " mine" : ""),
            type: "button",
            onclick: (e) => {
              e.stopPropagation();
              react(target, face, draw);
            },
          },
          face,
          el("span", { class: "num" }, String(counts[face]))
        )
      );
    }
  };
  draw();

  const pick = () => {
    if (card.querySelector(".react-pick")) return; // already open
    const box = el(
      "div",
      { class: "react-pick" },
      FACES.map((face) =>
        el(
          "button",
          {
            class: "react-big",
            type: "button",
            onclick: (e) => {
              e.stopPropagation();
              box.remove();
              react(target, face, draw);
            },
          },
          face
        )
      )
    );
    card.append(box);
    // It closes itself: a picker left open on every card an athlete
    // double-tapped past would be the screen filling up with faces.
    setTimeout(() => box.remove(), 4000);
  };

  card.classList.add("reactable");
  card.append(corner);
  card.addEventListener("dblclick", pick);
  // A phone sends no dblclick on some browsers, so two taps inside half a
  // second count as one here too.
  let last = 0;
  card.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - last < 500) pick();
    last = now;
  });
  return card;
}

/* The server's answer is what is drawn — a reaction that did not save must
   not sit on screen looking as though it did. */
function react(target, face, draw) {
  API.post("/api/reactions", { target: target, emoji: face })
    .then((d) => {
      FEED_FACES.counts[target] = d.counts || {};
      if (d.mine) FEED_FACES.mine[target] = d.mine;
      else delete FEED_FACES.mine[target];
      draw();
    })
    .catch((e) => toast(errorText(e)));
}

/* The live article, shown here as well as beside the session — the same
   words, and the same byline the cloud carries. */
function tipCard(tip) {
  const s = (tip[I18N.lang] && tip[I18N.lang].title ? tip[I18N.lang] : tip.en.title ? tip.en : tip.ar) || {};
  if (!s.title && !s.body) return el("div");
  return reactable(
    "tip:" + tip.id,
    el(
    "article",
    { class: "card pad stack post tip", dir: "auto" },
    // The day it went up, not the day it was last touched: fixing a typo in
    // an article does not republish it.
    el("div", { class: "post-head" },
      el("span", { class: "cloud-kicker" }, t("aCoachTip")),
      published(tip.created || tip.updated)),
    s.title ? el("h2", {}, s.title) : null,
    el("div", { class: "post-body" }, written(s.body)),
    // The coach's name and nothing else. The byline icon that goes with it
    // elsewhere carries no size of its own, and there is no rule here to give
    // it one, so it drew the width of the card.
    el(
      "div",
      { class: "sign-wrap" },
      el("a", { class: "sign", href: TIP_SIGN.url, target: "_blank", rel: "noopener noreferrer" }, tipSignName(I18N.lang))
    )
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
              {
                class: "board-row" + (r.me ? " me" : ""),
                role: "button",
                tabindex: "0",
                onclick: () => openRunner(r),
                onkeydown: (e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRunner(r); }
                },
              },
              el("span", { class: "place num" }, String(r.place)),
              avatarNode(r.avatar, r.name, "sm"),
              // The name, and under it the line they wrote about themselves.
              // This is the club looking at itself, so it is the one place a
              // bio is worth anything — a row of names is a row of names.
              el(
                "div",
                { class: "grow" },
                el("span", { class: "who", dir: "auto" }, r.me ? t("aYouAre") : r.name),
                r.bio ? el("div", { class: "board-bio", dir: "auto" }, r.bio) : null
              ),
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

/* A line about themselves, beside the face they picked. One line: the Worker
   squeezes whatever arrives onto one and cuts it at 160, and a box that looks
   like an essay invites one. Whose line it is sits beside the box they write
   it in, because that is when somebody decides who it is for — and it saves
   with the rest of the form, unlike the board tick on the points screen,
   which is its own errand. */
function bioBlock(user) {
  const input = el("textarea", { id: "f-bio", rows: "2", maxlength: "160", placeholder: t("aBioPh") });
  input.value = user.bio || "";
  const show = el("input", { type: "checkbox", id: "f-bio-show" });
  if (!user.bio_hidden) show.setAttribute("checked", "");
  const node = el(
    "div",
    {},
    el("label", { for: "f-bio" }, t("aBio")),
    input,
    el("label", { class: "sw", for: "f-bio-show" }, show, el("span", {}, t("aBioShow")))
  );
  return { input: input, show: show, node: node };
}

/* Their Instagram, and whether the club may have it. The tick sits under the
   box for the same reason the bio's does: whether it is for anybody else is
   decided while you are typing it, not on another screen. The box takes a
   pasted address as happily as a handle — the Worker keeps the handle out of
   whatever arrives. */
function igBlock(user) {
  const input = el("input", { type: "text", id: "f-ig", value: user.instagram || "", maxlength: "90", placeholder: t("aIgPh"), autocapitalize: "none", spellcheck: "false" });
  const show = el("input", { type: "checkbox", id: "f-ig-show" });
  if (!user.instagram_hidden) show.setAttribute("checked", "");
  const node = el(
    "div",
    {},
    el("label", { for: "f-ig" }, t("aIg")),
    input,
    el("label", { class: "sw", for: "f-ig-show" }, show, el("span", {}, t("aIgShow")))
  );
  return { input: input, show: show, node: node };
}

/* The coach's way to the track screen. Here rather than in the tab row: it is
   for the four people who take the sessions, and a sixth tab on a phone is a
   cost the whole club pays for them. Straight to coach.html, which is where
   this week's codes and rosters are.

   Only this one button. /admin is reached by its own address, and nothing in
   the app links to it: the console is a thing you go to deliberately, at a
   desk, and not a tap away from the screen a coach opens at the gate. */
function coachToolsCard() {
  if (!Auth.isCoach() && !Auth.isAdmin()) return null;
  return el(
    "div",
    { class: "card pad stack" },
    el("h3", {}, t("aCoachTools")),
    el("p", { class: "muted" }, t("aCoachLead")),
    el("div", { class: "row-wrap" }, el("a", { class: "btn primary", href: "coach.html" }, t("aCoachCodes")))
  );
}

SCREENS.me = function (args, user) {
  /* name + language */
  const name = el("input", { type: "text", id: "f-name", value: user.name, maxlength: 40, autocomplete: "name" });
  const gender = genderSelect(user.gender);
  const age = ageInput(user.birth_year);
  const bio = bioBlock(user);
  const avatar = avatarPicker(user, bio.node);
  const ig = igBlock(user);

  // What the home screen counts against. The club runs ten sessions a week
  // and nobody runs all ten, so the bounds are the ones the Worker keeps.
  const goal = el("input", {
    type: "number", id: "f-goal", inputmode: "numeric",
    min: "1", max: "10", step: "1", value: String(user.week_goal || 3),
  });
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
          Auth.update({
            name: name.value,
            gender: gender.value,
            birth_year: yearOfAge(age.value),
            avatar: avatar.value(),
            bio: bio.input.value,
            bio_hidden: !bio.show.checked,
            instagram: ig.input.value,
            instagram_hidden: !ig.show.checked,
            week_goal: goal.value,
          }).then(() => {
            saveOk.textContent = t("aSaved");
            saveOk.classList.remove("hidden");
            toast(t("aSaved"));
          })
        );
      },
    },
    avatar.node,
    field("aName", name),
    el("div", { class: "row" }, el("div", {}, el("label", { for: "f-gender" }, t("aGender")), gender),
      el("div", {}, el("label", { for: "f-age" }, t("aAge")), age)),
    ig.node,
    field("aGoal", goal, t("aGoalHint")),
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
    coachToolsCard(),
    remindCard(),
    // Nothing is gated on this — signups are open and mail may never be
    // configured — so it asks once, here, where someone came to change
    // their own details anyway.
    Auth.club.email && !user.email_verified_at ? confirmCard() : null,
    el("div", { class: "card pad stack" }, el("h3", {}, t("aChangePw")), pwForm),
    el(
      "div",
      { class: "card pad stack" },
      el("div", { class: "row-wrap" }, el("button", { class: "btn", onclick: out(false) }, t("aLogout")), el("button", { class: "btn", onclick: out(true) }, t("aLogoutAll")))
    ),
    // The same box that sits at the foot of a session, asked about the club
    // rather than about one run. It goes last, under logging out and above
    // the socials: an athlete who has finished with their account is the one
    // with something to say, and nothing here should push the settings down.
    feedbackCard({ name: "Club feedback" }, { titleKey: "aTellUs" })
  );
};

/* Two arrows, drawn once. The week header mirrors them for Arabic. */
const ICON_PATH = {
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
};

/* ---------- go ------------------------------------------------------------ */

/* The offline shell. Registered after first paint, because it is for the
   next visit rather than this one, and a phone that refuses it (a private
   window, an old browser) simply carries on without. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

Theme.apply(Theme.saved());
I18N.apply(I18N.initial());
window.addEventListener("hashchange", render);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!Theme.saved()) render();
});
appBoot();
