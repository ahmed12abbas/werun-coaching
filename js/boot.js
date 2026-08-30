"use strict";

/* =========================================================================
   WE RUN Coaching — entry point.

     no fragment   -> builder (the coach)
     #w=<payload>  -> viewer  (the athlete)

   The theme and language toggles just call boot() again, so there is one
   code path that produces the UI. `draft` survives that redraw, otherwise
   switching language mid-build would throw away the coach's session.
   ========================================================================= */

let draft = null;

function boot() {
  const app = $("#app");
  app.textContent = "";

  // Coming back from intervals.icu? Bank the handle before rendering.
  const linked = Connect.captureRedirect();

  const m = /(?:^|[#&])w=([^&]+)/.exec(location.hash || "");
  if (m) {
    let w;
    try {
      w = decodeWorkout(m[1]);
    } catch (e) {
      console.error(e);
      renderBrokenLink(app);
      return;
    }
    document.title = w.name + " · WE RUN";
    renderViewer(app, w, boot);
    if (linked && linked.ok) toast(t("cLinkedToast"));
    if (linked && !linked.ok) toast(linked.error);
    return;
  }

  document.title = "WE RUN Coaching";
  if (!draft) draft = defaultWorkout();
  renderBuilder(app, draft, boot);
}

function renderBrokenLink(app) {
  app.append(brandBar(null, boot));
  app.append(
    el(
      "div",
      { class: "card pad stack" },
      el("h2", {}, t("brokenTitle")),
      el("p", { class: "muted small" }, t("brokenLead")),
      el("a", { class: "btn primary", href: location.pathname }, t("brokenCta"))
    )
  );
}

/* Apply the saved look before the first paint, then draw. */
Theme.apply(Theme.saved());
I18N.apply(I18N.initial());

window.addEventListener("hashchange", boot);
// Following the device theme means reacting when the device changes it.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!Theme.saved()) boot();
});

boot();
