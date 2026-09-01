"use strict";

/* =========================================================================
   WE RUN Coaching — brand marks and icons.
   ========================================================================= */

const $ = (s, r) => (r || document).querySelector(s);

function el(tag, attrs) {
  const n = document.createElement(tag);
  const a = attrs || {};
  for (const k in a) {
    const v = a[k];
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (let i = 2; i < arguments.length; i++) {
    const kids = [].concat(arguments[i]);
    for (const k of kids) {
      if (k == null || k === false) continue;
      n.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
  }
  return n;
}

/**
 * Turn "tap **Save** now" into text nodes with a real <b> in the middle, so
 * translators write one sentence instead of a pile of concatenated fragments.
 */
function rich(text) {
  const out = [];
  String(text).split(/\*\*/).forEach((part, i) => {
    if (!part) return;
    out.push(i % 2 ? el("b", {}, part) : document.createTextNode(part));
  });
  return out;
}

const icon = (paths, cls) =>
  '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + "</svg>";

const ICON = {
  garmin: icon('<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9.5 6 10 2.5h4l.5 3.5M9.5 18l.5 3.5h4l.5-3.5"/><path d="M12 9.5v3l2 1.2"/>'),
  apple: icon('<path d="M12 7.2c-1.4 0-1.9-1-3.8-1S4 8 4 11.3C4 14.9 6.4 20 8.6 20c1.1 0 1.7-.8 3.2-.8s2 .8 3.1.8c2.2 0 4.6-5.1 4.6-8.7C19.5 8 17.2 6.2 15.8 6.2c-1.4 0-2 1-3.8 1Z"/><path d="M12.2 5.6c.9-1.1.7-2.7.7-2.7s-1.5.1-2.4 1.2"/>'),
  coros: icon('<circle cx="12" cy="12.2" r="6.2"/><path d="M9.6 6.4 10 2.5h4l.4 3.9M9.6 18l.4 3.5h4l.4-3.5"/><path d="M14.3 10.3a3 3 0 1 0 0 3.8"/>'),
  bolt: icon('<path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10H12z" fill="currentColor" stroke="none"/>'),
  cable: icon('<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M2 20h20"/>'),
  copy: icon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  link: icon('<path d="M10.5 13.5a4.5 4.5 0 0 0 6.4 0l2.1-2.1a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M13.5 10.5a4.5 4.5 0 0 0-6.4 0L5 12.6a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
  down: icon('<path d="M12 3v13m0 0 5-5m-5 5-5-5M4 21h16"/>'),
  send: icon('<path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8 21 3Z"/>'),
  caret: icon('<path d="M9 18l6-6-6-6"/>', "caret"),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  chat: icon('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.4A8 8 0 1 1 21 12Z"/>'),
  timer: icon('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.8"/><path d="M9.5 2.5h5"/><path d="M18.8 6.6l1.3-1.3"/>'),
  check: icon('<path d="M4 12.5 9.5 18 20 6.5"/>'),
  shield: icon('<path d="M12 3 5 6v6c0 4.2 2.9 7.9 7 9 4.1-1.1 7-4.8 7-9V6l-7-3Z"/><path d="M9 12.2l2 2 4-4.2"/>'),
  sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
  moon: icon('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>'),
};

/**
 * The WE RUN mark. Uses assets/logo.png when it's there and quietly falls
 * back to a Teko wordmark when it isn't, so the page never renders broken.
 */
function logoNode(height) {
  const h = height || 42;
  const fallback = el(
    "div",
    { class: "brand-fallback hidden", style: "font-size:" + Math.round(h * 0.55) + "px" },
    el("div", {}, "WE"),
    el("div", {}, "RUN")
  );
  const img = el("img", {
    class: "brand-logo",
    src: "assets/logo.png",
    alt: "WE RUN",
    style: "height:" + h + "px",
    onerror: function () {
      img.remove();
      fallback.classList.remove("hidden");
    },
  });
  return el("div", { class: "row", style: "gap:10px" }, img, fallback);
}

/**
 * Theme and language toggles. Both re-render the page rather than trying to
 * patch it in place — the whole view is cheap to rebuild and this way there
 * is only one code path that produces the UI.
 */
function toolButtons(rerender) {
  const dark = Theme.current() === "dark";
  return el(
    "div",
    { class: "brand-tools" },
    el(
      "button",
      {
        class: "tool",
        title: dark ? t("themeLight") : t("themeDark"),
        "aria-label": dark ? t("themeLight") : t("themeDark"),
        html: dark ? ICON.sun : ICON.moon,
        onclick: () => {
          Theme.toggle();
          rerender();
        },
      }
    ),
    el(
      "button",
      {
        class: "tool text",
        title: t("langLabel"),
        "aria-label": t("langLabel"),
        onclick: () => {
          I18N.toggle();
          rerender();
        },
      },
      t("langLabel")
    )
  );
}

/** Header used on every screen. `right` is an optional trailing node. */
function brandBar(right, rerender) {
  return el(
    "div",
    { class: "brand" },
    logoNode(42),
    el("div", { class: "brand-sub" }, t("coaching")),
    rerender ? toolButtons(rerender) : null,
    right ? el("div", { class: rerender ? "" : "push" }, right) : null
  );
}
