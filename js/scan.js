"use strict";

/* =========================================================================
   WE RUN Coaching — reading the coach's check-in code with the phone's camera.

   Until this existed an athlete at the track had to leave the app, open the
   camera, scan, and be handed back — which is three steps too many at 04:55
   with a code that expires in thirty seconds. Join opens the camera here.

   Nothing is bundled and nothing is fetched: decoding is the browser's own
   BarcodeDetector. Where it is missing — iOS Safari, most notably, which is
   half the club — the overlay says to use the phone's camera app instead,
   because the QR carries a full URL and that route has always worked.

   Only the check-in path of this very origin is ever followed. A QR is a
   stranger's text until proven otherwise: whatever the camera reads, this
   hands back the three fields of a check-in link or nothing at all.
   ========================================================================= */

const Scan = (function () {
  /* Every 250ms: a code is on screen for thirty seconds, so there is nothing
     to win by hammering the decoder and a phone held up to a screen is warm
     enough already. */
  const EVERY_MS = 250;

  let overlay = null;
  let stream = null;
  let timer = null;

  const supported = () =>
    typeof window !== "undefined" &&
    "BarcodeDetector" in window &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  /**
   * The three fields of a check-in link, or null.
   *
   * Same-origin only, and matched against the shape the Worker signs — a
   * code that points anywhere else is somebody else's QR, and following it
   * is the one thing a scanner must never do.
   */
  function readCheckin(text) {
    let url;
    try {
      url = new URL(String(text), location.href);
    } catch (e) {
      return null;
    }
    if (url.origin !== location.origin) return null;
    const m = /^#\/c\/([A-Za-z0-9_-]{1,64})\/(\d{1,15})\/([0-9a-f]{16})$/.exec(url.hash);
    return m ? { session: m[1], slot: m[2], sig: m[3] } : null;
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  }

  function close() {
    stop();
    if (overlay) overlay.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  /**
   * Open the camera and call back with { session, slot, sig } on the first
   * check-in code it reads. Closes itself; the caller only navigates.
   */
  function open(onCode) {
    close();

    const note = el("p", { class: "scan-note" }, t("aScanLead"));
    const video = el("video", { class: "scan-video", playsinline: true, muted: true, autoplay: true });
    const frame = el("div", { class: "scan-frame" }, video, el("div", { class: "scan-box" }));

    overlay = el(
      "div",
      { class: "scan", role: "dialog", "aria-modal": "true", "aria-label": t("aScanTitle") },
      el(
        "div",
        { class: "scan-card" },
        el("h2", {}, t("aScanTitle")),
        frame,
        note,
        el("button", { class: "btn block", type: "button", onclick: close }, t("aClose"))
      )
    );
    document.body.append(overlay);
    document.addEventListener("keydown", onKey);

    if (!supported()) {
      frame.remove();
      note.textContent = t("aScanNoCam");
      return;
    }

    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        // Closed while the permission prompt was still up: let the camera go
        // rather than leave the light on behind a dismissed dialog.
        if (!overlay) {
          for (const track of s.getTracks()) track.stop();
          return;
        }
        stream = s;
        video.srcObject = s;
        video.play().catch(() => {});

        timer = setInterval(() => {
          if (!video.videoWidth) return;
          detector
            .detect(video)
            .then((found) => {
              if (!found || !found.length || !overlay) return;
              for (const code of found) {
                const hit = readCheckin(code.rawValue);
                if (!hit) continue;
                // One code, one navigation: stop the camera before handing
                // over, or the interval fires again mid-check-in.
                stop();
                close();
                onCode(hit);
                return;
              }
              // Something was read and it was not ours. Say so and keep
              // looking — the coach's code may be the next frame.
              note.textContent = t("aScanWrong");
            })
            .catch(() => {});
        }, EVERY_MS);
      })
      .catch(() => {
        if (!overlay) return;
        frame.remove();
        note.textContent = t("aScanDenied");
      });
  }

  return { open: open, close: close, supported: supported, readCheckin: readCheckin };
})();
