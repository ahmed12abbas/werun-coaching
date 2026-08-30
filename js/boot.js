"use strict";

/* =========================================================================
   WE RUN Coaching — entry point.

     no fragment   -> builder (the coach)
     #w=<payload>  -> viewer  (the athlete)
   ========================================================================= */

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
    renderViewer(app, w);
    if (linked && linked.ok) toast("Connected — you can send it to your watch now");
    if (linked && !linked.ok) toast("Connecting failed: " + linked.error);
    return;
  }

  renderBuilder(app, defaultWorkout());
}

function renderBrokenLink(app) {
  app.append(brandBar());
  app.append(
    el(
      "div",
      { class: "card pad stack" },
      el("h2", {}, "That link looks broken"),
      el(
        "p",
        { class: "muted small" },
        "The session couldn't be read. Ask your coach to send it again — chat apps sometimes cut long links in half."
      ),
      el("a", { class: "btn primary", href: location.pathname }, "Build a session instead")
    )
  );
}

window.addEventListener("hashchange", boot);
boot();
