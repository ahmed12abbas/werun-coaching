"use strict";

/* =========================================================================
   WE RUN Coaching — how a coach's plain typing becomes blocks.

   Three pages render the same articles: the athlete's cloud (js/tips.js),
   the editor's live preview (tips.html) and the read-only viewer on the
   share dashboard (admin.html). If these rules drift apart the preview
   starts lying about what athletes will actually see, so they live here
   once and all three call in.

   Deliberately DOM-free and dependency-free: it hands back a plain
   description of the blocks and each page builds nodes with its own el().
   That is what lets the two standalone pages load it without dragging in
   the rest of the site's javascript.
   ========================================================================= */

/**
 * Split a coach's typing into blocks:
 *
 *   { kind: "p",  text: "one paragraph, its lines joined" }
 *   { kind: "ul", items: ["first bullet", "second bullet"] }
 *
 * A blank line starts a new block. A block counts as a list only when every
 * line in it opens with a dash, so a dash used mid-sentence stays part of
 * the sentence rather than turning the paragraph into a list.
 */
function tipBlocks(text) {
  var out = [];
  String(text || "").split(/\n\s*\n/).forEach(function (block) {
    var lines = block.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return;

    var bullet = /^[-•*]\s+/;
    if (lines.every(function (l) { return bullet.test(l); })) {
      out.push({
        kind: "ul",
        items: lines.map(function (l) { return l.replace(bullet, ""); }),
      });
    } else {
      out.push({ kind: "p", text: lines.join(" ") });
    }
  });
  return out;
}

/**
 * Split a line on ** markers into runs:
 *
 *   [{ bold: false, text: "we start " }, { bold: true, text: "five seconds slower" }]
 *
 * Callers turn these into text nodes and <b>, and nothing else — which is
 * why an article can emphasise a phrase but can never put markup into the
 * page. Empty runs are dropped so "**bold**" at the start of a line does not
 * produce a leading blank.
 */
function tipRuns(text) {
  return String(text == null ? "" : text)
    .split("**")
    .map(function (part, i) { return { bold: i % 2 === 1, text: part }; })
    .filter(function (run) { return run.text; });
}

/**
 * The coach's byline, shown under every article on all three surfaces.
 *
 * It lives here rather than in js/i18n.js because the two standalone pages
 * have no translation table to read from, and the editor's preview has to
 * show exactly what athletes will get. The credential stays in Latin in both
 * languages: it is the name of the qualification, not a phrase to translate.
 */
var TIP_SIGN = {
  url: "https://www.instagram.com/h__enroute/",
  name: {
    en: "C.Hadeel Ashour (UESCA certified running coach)",
    ar: "ك. هديل عاشور (UESCA certified running coach)",
  },
  // An arrow rather than a platform logo: it says "this goes somewhere"
  // without stamping Instagram’s brand across the club’s own page. Mirrored
  // in RTL by the pages that render it.
  icon:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 12h13M12 6l6 6-6 6"/></svg>',
};

/** The byline for a language, falling back to English. */
function tipSignName(lang) {
  return TIP_SIGN.name[lang] || TIP_SIGN.name.en;
}
