"use strict";

/* =========================================================================
   WE RUN Coaching — the athlete's say.

   Five stars, a name and a comment, posted to /api/feedback and read back on
   the coach's dashboard at /admin. It sits at the foot of the session beside
   the share link, which is where an athlete has finished reading and is the
   only moment they have an opinion to give.

   Deliberately shallow: no account, no email, nothing required but a star.
   A rating with an empty name and an empty comment is still worth having —
   most people will give exactly that, and asking for more is how a box like
   this ends up unused.

   The whole card is rebuilt by the language toggle along with the rest of the
   page, so nothing here has to follow a language change on its own.
   ========================================================================= */

const FEEDBACK_ENDPOINT = "/api/feedback";
// Their name, so an athlete who rates a second session is not asked twice.
const RATER_KEY = "werun.rater";

const STAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 2.4l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.4l-5.88 3.11 1.12-6.55L2.48 9.32l6.58-.96z"/>' +
  "</svg>";

function savedName() {
  try {
    return String(localStorage.getItem(RATER_KEY) || "").slice(0, 40);
  } catch (e) {
    return ""; // private mode, or storage switched off
  }
}

function rememberName(name) {
  try {
    if (name) localStorage.setItem(RATER_KEY, name);
  } catch (e) {}
}

/**
 * The five stars.
 *
 * A real radio group rather than five loose buttons: one stop in the tab
 * order, arrow keys inside it, and a screen reader that says "3 out of 5,
 * radio button" instead of reading five unrelated stars. Hovering previews
 * the fill without committing it, which is the whole grammar of a star
 * rating — you see what you are about to say before you say it.
 */
function starPicker() {
  let value = 0;
  const stars = [1, 2, 3, 4, 5];

  const btns = stars.map((n) =>
    el("button", {
      class: "star",
      type: "button",
      role: "radio",
      "aria-checked": "false",
      "aria-label": t("fbStar", { n: String(n) }),
      // Roving tabindex: the group is one stop, the arrows do the rest.
      tabindex: n === 1 ? "0" : "-1",
      // Its own voice, pitched by how many stars — the page-wide click would
      // say the same thing five times over.
      "data-sfx": "off",
      html: STAR_SVG,
      onclick: () => set(n),
      onmouseenter: () => paint(n),
      onfocus: () => paint(n),
      onmouseleave: () => paint(value),
      onblur: () => paint(value),
    })
  );

  const group = el(
    "div",
    {
      class: "stars",
      role: "radiogroup",
      "aria-label": t("fbRating"),
      onkeydown: (e) => {
        // ArrowRight means "more" in English and "less" in Arabic, because
        // the row itself is mirrored — the athlete's hand is moving towards
        // the fifth star either way.
        const rtl = (document.documentElement.getAttribute("dir") || "ltr") === "rtl";
        let step = 0;
        if (e.key === "ArrowRight") step = rtl ? -1 : 1;
        else if (e.key === "ArrowLeft") step = rtl ? 1 : -1;
        else if (e.key === "ArrowUp") step = 1;
        else if (e.key === "ArrowDown") step = -1;
        if (!step) return;
        e.preventDefault();
        const next = clampNum((value || 0) + step, 1, 5);
        if (next !== value) set(next);
        btns[next - 1].focus();
      },
    },
    btns
  );

  /** Fill up to n, without saying anything about what is chosen. */
  function paint(n) {
    btns.forEach((b, i) => b.classList.toggle("on", i < n));
  }

  function set(n) {
    value = n;
    SFX.star(n);
    btns.forEach((b, i) => {
      b.setAttribute("aria-checked", i === n - 1 ? "true" : "false");
      b.setAttribute("tabindex", i === n - 1 ? "0" : "-1");
    });
    paint(n);
    group.classList.remove("asking");
  }

  return {
    node: group,
    value: () => value,
    /** Say, without a word, that this is the part that is missing. */
    ask: () => {
      group.classList.remove("asking");
      void group.offsetWidth;
      group.classList.add("asking");
      btns[0].focus();
    },
  };
}

/**
 * The card. `w` is the session being rated — its name rides along so the
 * dashboard can show what an athlete had just run when they wrote.
 */
function feedbackCard(w) {
  const picker = starPicker();

  const name = el("input", {
    type: "text",
    maxlength: "40",
    autocomplete: "name",
    placeholder: t("fbNamePh"),
    value: savedName(),
  });

  const comment = el("textarea", {
    rows: "3",
    maxlength: "700",
    placeholder: t("fbCommentPh"),
  });

  const err = el("p", { class: "small rate-err hidden" });

  const send = el(
    "button",
    { class: "btn primary block", type: "button", onclick: () => submit() },
    t("fbSend")
  );

  const form = el(
    "div",
    { class: "stack" },
    picker.node,
    el("div", {}, el("label", {}, t("fbName")), name),
    el("div", {}, el("label", {}, t("fbComment")), comment),
    send,
    err
  );

  const card = el(
    "div",
    { class: "card pad rate" },
    el("h2", { class: "rate-title" }, t("fbTitle")),
    el("p", { class: "rate-lead" }, t("fbLead")),
    form
  );

  function fail(message) {
    err.textContent = message;
    err.classList.remove("hidden");
    send.disabled = false;
    send.textContent = t("fbSend");
  }

  /**
   * The thank-you takes the card over. Their words are gone from the screen
   * at that point, which is the right ending: it says the note has left,
   * rather than leaving them looking at a box that might not have sent.
   */
  function thanks() {
    form.remove();
    card.querySelector(".rate-lead").remove();
    card.querySelector(".rate-title").remove();
    card.classList.add("done");
    card.append(
      el("div", { class: "rate-done" }, el("div", { class: "rate-hearts" }, "💜🤍"),
        el("p", { class: "rate-thanks" }, t("fbThanks")),
        el("p", { class: "rate-tag" }, t("fbTag")))
    );
  }

  function submit() {
    if (!picker.value()) {
      // The one thing that is actually required, and the only complaint the
      // card ever makes.
      picker.ask();
      fail(t("fbNeedStars"));
      return;
    }
    err.classList.add("hidden");
    send.disabled = true;
    send.textContent = t("fbSending");

    const who = name.value.trim().slice(0, 40);
    rememberName(who);

    fetch(FEEDBACK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rating: picker.value(),
        name: who,
        comment: comment.value.trim(),
        session: (w && w.name) || "",
        lang: (typeof I18N !== "undefined" && I18N.lang) || "en",
      }),
    })
      .then((res) => {
        if (res.ok) return thanks();
        // Their words stay in the box either way, so a retry is a tap and
        // not a retype.
        fail(res.status === 429 ? t("fbTooOften") : t("fbFailed"));
      })
      .catch(() => fail(t("fbFailed")));
  }

  return card;
}
