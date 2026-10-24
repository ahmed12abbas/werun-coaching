"use strict";
var root = document.documentElement;
var btn = document.getElementById("lang");
var page = document.getElementById("page");
var saved = null; // the admin's copy, once /api/about has answered
var live = null;  // the follower counts the Worker read by itself

function current() { return root.getAttribute("lang") === "ar" ? "ar" : "en"; }

function show(lang) {
  root.setAttribute("lang", lang);
  root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  btn.textContent = lang === "ar" ? "English" : "العربية";
  document.getElementById("back").textContent = lang === "ar" ? "→ WE RUN" : "← WE RUN";
  document.getElementById("privacy").textContent = lang === "ar" ? "الخصوصية" : "Privacy";
  document.title = (lang === "ar" ? "من نحن" : "Who Are We") + " · WE RUN";
  document.getElementById("socials").setAttribute("aria-label", lang === "ar" ? "WE RUN على منصات التواصل" : "WE RUN on social");
  up.setAttribute("aria-label", lang === "ar" ? "إلى الأعلى" : "Back to top");
  up.title = up.getAttribute("aria-label");
  paintTheme();
  aboutRender(page, saved || ABOUT_DEFAULT, lang, live);
  revealAll();
}

/* Light and dark, the same switch as the app's (Theme in js/i18n.js): the
   same key, the same attribute, so a choice made in either carries to the
   other. Not loaded from i18n.js for four lines out of twelve hundred. */
var themeBtn = document.getElementById("theme");
function isDark() {
  return root.getAttribute("data-theme") === "dark"; // nothing chosen yet is light
}
function paintTheme() {
  var dark = isDark(), ar = current() === "ar";
  themeBtn.innerHTML = dark ? ICON.sun : ICON.moon;
  var label = dark ? (ar ? "الوضع الفاتح" : "Light mode") : (ar ? "الوضع الداكن" : "Dark mode");
  themeBtn.title = label;
  themeBtn.setAttribute("aria-label", label);
}
themeBtn.addEventListener("click", function () {
  var next = isDark() ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("werun.theme", next); } catch (e) {}
  paintTheme();
});
paintTheme();

/* Sections rise into place as they come into view and their numbers count
   up to themselves -- once each, and only for a reader who has not asked for
   less motion, in a browser that can say what is on screen. */
var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var seen = !calm && "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
  entries.forEach(function (e) {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    seen.unobserve(e.target);
    e.target.querySelectorAll(".num").forEach(countUp);
  });
}, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }) : null;
if (seen) root.classList.add("reveal");

function revealAll() {
  if (!seen) return;
  Array.prototype.forEach.call(page.children, function (sec) {
    sec.querySelectorAll(".stat,.goal,.sess,.gallery figure,.logos > div,.event").forEach(function (c, i) {
      c.style.transitionDelay = Math.min(i, 10) * 60 + "ms";
    });
    // What is already on screen (or scrolled past) is simply there, rather
    // than invisible until the observer's first report -- which never comes
    // in a view that is not painting.
    if (sec.getBoundingClientRect().top < window.innerHeight) {
      sec.classList.add("in");
      sec.querySelectorAll(".num").forEach(countUp);
    } else {
      seen.observe(sec);
    }
  });
}

/* "2800+" from 0+, "17.1K" from 0.0K: the number moves, whatever follows it
   stays put. Anything that does not start with digits is left alone. */
function countUp(n) {
  var m = /^(\d+(?:\.\d+)?)(.*)$/.exec(n.textContent.trim());
  if (!m) return;
  var end = parseFloat(m[1]), dp = (m[1].split(".")[1] || "").length, rest = m[2], t0 = null;
  function step(t) {
    if (t0 === null) t0 = t;
    var p = Math.min(1, (t - t0) / 1200);
    n.textContent = (end * (1 - Math.pow(1 - p, 3))).toFixed(dp) + rest;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* The app's own five links, drawn from its list rather than a second copy.
   The svg is ours, from js/brand.js, never anything an admin typed. */
var up = document.getElementById("totop");
SOCIAL.forEach(function (s) {
  var a = document.createElement("a");
  a.href = s.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = s.label;
  a.setAttribute("aria-label", s.label);
  a.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + s.svg + "</svg>";
  document.getElementById("socials").append(a);
});

/* js/sfx.js sounds every button on its own; the social links and the account
   chips are pressed like buttons too, so they click as well. */
document.addEventListener("click", function (e) {
  if (e.target.closest && e.target.closest(".socials a, a.plat, a.badge")) SFX.click();
}, true);

/* Shown once the top is a long way off; kept out of the tab order while it
   is hidden, and it hands focus back to the top so a keyboard follows. */
function upState() {
  var on = window.scrollY > 700;
  up.classList.toggle("on", on);
  up.tabIndex = on ? 0 : -1;
  up.setAttribute("aria-hidden", on ? "false" : "true");
}
window.addEventListener("scroll", upState, { passive: true });
upState();
up.addEventListener("click", function () {
  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
  document.getElementById("back").focus({ preventScroll: true });
});

btn.addEventListener("click", function () {
  var next = current() === "ar" ? "en" : "ar";
  try { localStorage.setItem("werun.lang", next); } catch (e) {}
  show(next);
});

/* Drawn once the saved copy is in, so an edited page does not flash the
   original first -- unless the answer is slow, when the original is better
   than a blank page and is swapped out when it lands. */
var early = setTimeout(function () { show(current()); }, 1500);
fetch("/api/about").then(function (r) { return r.ok ? r.json() : {}; })
  .then(function (d) {
    if (d && d.doc && Array.isArray(d.doc.sections)) saved = d.doc;
    live = (d && d.live) || null;
  })
  ["catch"](function () {})
  .then(function () { clearTimeout(early); show(current()); });
