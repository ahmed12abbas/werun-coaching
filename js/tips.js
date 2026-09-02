"use strict";

/* =========================================================================
   WE RUN Coaching — Coach Tips.

   The club logo pops in beside the session title; tapping it opens a speech
   cloud holding whatever article the coach has put live at /tips.

   The article is fetched once per page load from /api/tips and the button
   only appears once one has come back, so on the static mirror — where no
   Worker answers — athletes never meet a button that cannot open.
   ========================================================================= */

const TIPS_ENDPOINT = "/api/tips";

/* One fetch per page load, shared by every render. The language toggle
   rebuilds the whole viewer, and re-asking the network each time an athlete
   flipped to Arabic and back would be a request for nothing. */
let TIPS_PROMISE = null;

function loadTip() {
  if (TIPS_PROMISE) return TIPS_PROMISE;
  TIPS_PROMISE = fetch(TIPS_ENDPOINT, { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.article) || null)
    .catch(() => null); // offline, blocked, or no Worker: the session still works
  return TIPS_PROMISE;
}

/**
 * Article text into nodes.
 *
 * The rules themselves live in js/tipfmt.js, shared with the editor's preview
 * and the dashboard's viewer so the three cannot drift apart and start
 * disagreeing about what athletes will see. Here they only become elements.
 */
function tipParagraphs(text) {
  const nodes = [];
  for (const block of tipBlocks(text)) {
    if (block.kind === "ul") {
      const ul = el("ul", { class: "cloud-list" });
      for (const item of block.items) ul.append(el("li", {}, tipInline(item)));
      nodes.push(ul);
    } else {
      nodes.push(el("p", {}, tipInline(block.text)));
    }
  }
  return nodes;
}

/** Runs into text nodes and <b>, and nothing else. */
function tipInline(text) {
  return tipRuns(text).map((run) =>
    run.bold ? el("b", {}, run.text) : document.createTextNode(run.text)
  );
}

/** The half of the article to show, falling back to the other language. */
function tipSide(article, lang) {
  const want = article[lang] || {};
  if (want.title || want.body) return want;
  return article[lang === "ar" ? "en" : "ar"] || {};
}

/**
 * The logo mark that pops. Rebuilt here in markup rather than played as a
 * video or a canvas so it costs a few hundred bytes, inherits the page's own
 * theme, and stops dead under prefers-reduced-motion.
 */
function tipMark() {
  const bulb = el(
    "span",
    { class: "tips-bulb" },
    [-52, -26, 0, 26, 52].map((a) => el("i", { class: "ray", style: "--a:" + a + "deg" })),
    el("i", { class: "glass" }),
    el("i", { class: "shine" }),
    el("i", { class: "cap" })
  );

  const logo = el("img", {
    class: "tips-logo",
    src: "assets/logo.png",
    alt: "",
    // The pop is the point; a broken image icon springing in is not.
    onerror: function () {
      logo.remove();
    },
  });

  return el(
    "span",
    { class: "tips-mark", "aria-hidden": "true" },
    el("i", { class: "tips-burst" }),
    logo,
    bulb
  );
}

/**
 * The coach's byline, under every article. Opens in a new tab: an athlete
 * halfway through reading should not lose the session to Instagram.
 */
function tipSignature(lang) {
  return el(
    "a",
    {
      class: "cloud-sign",
      href: TIP_SIGN.url,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    el("span", { class: "cloud-sign-ic", html: TIP_SIGN.icon }),
    el("span", {}, tipSignName(lang))
  );
}

/**
 * The button and the cloud it opens.
 *
 * Both start hidden and the button reveals itself only if the coach has an
 * article live. The caller places the three nodes: button beside the session
 * title, cloud under the session head, scrim anywhere (it is fixed, and only
 * ever visible behind the phone sheet).
 */
function tipsCorner() {
  let article = null;
  let open = false;
  let popTimer = null;

  // What the caller gets back. The nodes are filled in at the end; the closer
  // is here from the start so the pace calculator can be handed it — this
  // cloud and that panel both hang off the session head, and two of them up
  // at once is two things talking over each other. Closing this way is
  // silent: the panel that did it plays its own sound.
  const api = { button: null, cloud: null, scrim: null, onOpen: null, close: () => setOpen(false) };

  const kicker = el("span", { class: "cloud-kicker" }, t("tipsKicker"));
  const title = el("h2", { class: "cloud-title" });
  const body = el("div", { class: "cloud-body" });
  const sign = el("div", { class: "cloud-sign-wrap" });

  const closeBtn = el(
    "button",
    {
      class: "cloud-x",
      type: "button",
      "data-sfx": "off", // plays its own on the way down
      "aria-label": t("tipsClose"),
      onclick: () => {
        SFX.unpop();
        setOpen(false);
      },
    },
    "✕"
  );

  const inner = el(
    "div",
    { class: "cloud-inner", onscroll: () => syncFade() },
    el("div", { class: "cloud-head" }, kicker, closeBtn),
    title,
    body,
    sign
  );

  const cloud = el(
    "div",
    { class: "cloud hidden", role: "dialog", "aria-label": t("tipsKicker"), tabindex: "-1" },
    el("span", { class: "cloud-tail", "aria-hidden": "true" }),
    inner
  );

  const scrim = el(
    "div",
    {
      class: "cloud-scrim hidden",
      onclick: () => {
        SFX.unpop();
        setOpen(false);
      },
    }
  );

  const button = el(
    "button",
    {
      class: "btn sm tips-toggle hidden",
      type: "button",
      "data-sfx": "off", // pop on the way up, the same shape down on the way back
      "aria-expanded": "false",
      onclick: () => {
        // The cork out of the bottle on the way up, the same shape run
        // downhill on the way back. Only the button and the cloud's own
        // closers make a sound: when the pace panel shuts this cloud it
        // plays its own click, and two noises for one tap reads as a
        // stutter.
        if (open) SFX.unpop();
        else SFX.pop();
        setOpen(!open);
      },
      // Replaying the pop on hover is the desktop half of the invitation the
      // first pop makes; a phone gets it on tap instead.
      onmouseenter: () => pop(),
    },
    // The comet laps the rim while the cloud is shut, the same invitation the
    // pace button makes — the other way round, so the pair reads as two things
    // rather than one repeated twice.
    el("span", { class: "tips-glow", "aria-hidden": "true" }),
    tipMark(),
    el("span", { class: "tips-face" }, t("tipsOpen"))
  );

  /** Run the pop once. Restarting means dropping the class for a frame. */
  function pop() {
    if (open) return; // nothing to invite once the cloud is already up
    button.classList.remove("pop");
    void button.offsetWidth; // force the removal to land before it goes back
    button.classList.add("pop");
    clearTimeout(popTimer);
    popTimer = setTimeout(() => button.classList.remove("pop"), 2200);
  }

  function fill() {
    const lang = (typeof I18N !== "undefined" && I18N.lang) || "en";
    const side = tipSide(article, lang);
    title.textContent = side.title || "";
    body.textContent = "";
    // Node.append() would stringify an array; el() is the only helper here
    // that spreads one.
    for (const node of tipParagraphs(side.body)) body.append(node);

    // Rebuilt with the body so it follows the language toggle.
    sign.textContent = "";
    sign.append(tipSignature(lang));
  }

  /**
   * The article scrolls inside the cloud, and a line cut off by the bottom
   * edge reads as a rendering fault rather than "there is more below". Fade
   * that edge while there is more, and drop it the moment there is not, so
   * the last line of a short article is never dimmed for nothing.
   */
  function syncFade() {
    const more = inner.scrollHeight - inner.scrollTop - inner.clientHeight > 2;
    cloud.classList.toggle("more", more);
  }

  /**
   * Point the tail at the button. The cloud is the width of the card while
   * the button sits wherever the title left room for it, so the only honest
   * answer is a measured one — and it has to be taken again when a resize
   * wraps the button onto its own line.
   */
  function aimTail() {
    if (!open) return;
    const b = button.getBoundingClientRect();
    const c = cloud.getBoundingClientRect();
    if (!c.width) return;
    const x = b.left + b.width / 2 - c.left;
    // Never onto the rounded corners, where a tail reads as a glitch.
    cloud.style.setProperty("--tail", Math.max(20, Math.min(c.width - 20, x)) + "px");
  }

  function setOpen(next) {
    if (next === open) return;
    open = next;
    cloud.classList.toggle("hidden", !open);
    scrim.classList.toggle("hidden", !open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    // Only the phone sheet actually locks the page; the class is free on
    // desktop, where the cloud sits in the flow and scrolls with everything.
    document.documentElement.classList.toggle("cloud-open", open);
    if (open) {
      button.classList.remove("pop");
      aimTail();
      syncFade();
      cloud.focus();
      if (api.onOpen) api.onOpen();
    }
  }

  window.addEventListener("resize", () => {
    aimTail();
    syncFade();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      SFX.unpop();
      setOpen(false);
    }
  });

  api.button = button;
  api.cloud = cloud;
  api.scrim = scrim;

  loadTip().then((found) => {
    if (!found) return; // nothing live: the button never appears at all
    article = found;
    fill();
    if (!title.textContent) return; // live but empty in both languages
    button.classList.remove("hidden");
    pop();
  });

  return api;
}
