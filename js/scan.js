"use strict";

/* =========================================================================
   WE RUN Coaching — reading the coach's check-in code with the phone's camera.

   Until this existed an athlete at the track had to leave the app, open the
   camera, scan, and be handed back — which is three steps too many at 04:55
   with a code that expires in thirty seconds. Join opens the camera here.

   Two decoders, in this order:

     BarcodeDetector    the browser's own, on Android Chrome. Faster than
                        anything we could ship and costs no download at all.
     js/vendor/jsqr     everywhere else, which in practice means iPhones.
                        Fetched the first time somebody opens the scanner and
                        never on a page that does not — see js/vendor/README.

   Only the check-in path of this very origin is ever followed. A QR is a
   stranger's text until proven otherwise: whatever the camera reads, this
   hands back the three fields of a check-in link or nothing at all.
   ========================================================================= */

const Scan = (function () {
  /* Between reads, not between starts: a frame costs about 60ms to decode on
     a laptop and several times that on a phone, so an interval would stack
     callbacks on the very devices this exists for. A code is on screen for
     thirty seconds — there is nothing to win by hammering it. */
  const EVERY_MS = 250;

  /* The version is in the filename on purpose — nothing stamps this URL, so a
     bump has to be a new one. See js/vendor/README.md. */
  const DECODER_SRC = "js/vendor/jsqr-1.4.0.js";

  /* What the fallback decoder is given, and not a pixel more. A phone hands
     over 1080 lines; jsQR reads 480 of them in about 60ms and 640 in nearly a
     second, because past a certain size its locator starts hunting. Measured,
     not guessed — the cliff between the two is real and this sits below it. */
  const WORK_WIDTH = 480;

  /* Told apart from "the decoder would not load", which also has nothing to
     hand on: one of them wants the reader-failed message and the other wants
     silence, because the athlete has already shut the panel. */
  const CLOSED = {};

  let overlay = null;
  let stream = null;
  let timer = null;
  let loading = null;

  /** Can this browser open a camera at all? The decoder is always available. */
  const supported = () =>
    typeof window !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

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

  /** Fetch the vendored decoder, once, and say whether it is usable. */
  function load() {
    if (window.jsQR) return Promise.resolve(true);
    if (loading) return loading;
    loading = new Promise((resolve) => {
      const tag = document.createElement("script");
      tag.src = DECODER_SRC;
      tag.onload = () => resolve(!!window.jsQR);
      // A failed fetch must not be remembered as a failure forever: somebody
      // on a bad connection at the track gets another go by tapping again.
      tag.onerror = () => {
        loading = null;
        resolve(false);
      };
      document.head.append(tag);
    });
    return loading;
  }

  /**
   * Decode one canvas with the vendored reader. Returns the text or null.
   * Exposed because it is the seam the browser check drives — there is no way
   * to point a camera at anything from a test.
   */
  function decodeFrom(canvas) {
    if (!window.jsQR) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // dontInvert: the coach's screen shows dark on light like every other QR,
    // and asking jsQR to try the negative as well doubles the work per frame.
    const hit = window.jsQR(px.data, px.width, px.height, { inversionAttempts: "dontInvert" });
    return hit && hit.data ? hit.data : null;
  }

  /**
   * Whatever this browser can read frames with: a function taking the video
   * and handing back the strings it found. Null when neither decoder can be
   * had — no BarcodeDetector and the vendored one would not load.
   */
  async function readerFor() {
    if ("BarcodeDetector" in window) {
      try {
        const native = new window.BarcodeDetector({ formats: ["qr_code"] });
        return (video) => native.detect(video).then((found) => (found || []).map((c) => c.rawValue));
      } catch (e) {
        // A BarcodeDetector that cannot do QR codes is no use; fall through
        // to the one we ship, which can.
      }
    }
    if (!(await load())) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return (video) => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return Promise.resolve([]);
      const scale = Math.min(1, WORK_WIDTH / w);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const text = decodeFrom(canvas);
      return Promise.resolve(text ? [text] : []);
    };
  }

  function stop() {
    clearTimeout(timer);
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

    const shut = (message) => {
      frame.remove();
      note.textContent = message;
    };

    if (!supported()) return shut(t("aScanNoCam"));

    // The camera is asked for first and awaited nowhere before it: Safari
    // only grants getUserMedia to a user gesture, and an await in front of it
    // is enough to lose the gesture and the permission with it. The decoder
    // loads alongside, which is time the permission prompt was spending
    // anyway.
    const camera = navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    const decoder = readerFor();

    camera
      .then((s) => {
        // Closed while the permission prompt was still up: let the camera go
        // rather than leave the light on behind a dismissed dialog.
        if (!overlay) {
          for (const track of s.getTracks()) track.stop();
          return CLOSED;
        }
        stream = s;
        video.srcObject = s;
        // iOS will not start a stream without this, and ignores the promise.
        video.play().catch(() => {});
        return decoder;
      })
      .then((read) => {
        if (read === CLOSED || !overlay) return;
        if (!read) return shut(t("aScanNoReader"));

        // One read at a time. Each one schedules the next when it is done,
        // however it went, so a slow phone falls behind gracefully instead of
        // queueing decodes it will never catch up on.
        const schedule = () => {
          if (!overlay) return;
          timer = setTimeout(tick, EVERY_MS);
        };

        function tick() {
          if (!overlay) return;
          if (!video.videoWidth) return schedule();
          read(video)
            .then((found) => {
              if (!found || !found.length || !overlay) return;
              for (const raw of found) {
                const hit = readCheckin(raw);
                if (!hit) continue;
                // One code, one navigation: stop the camera before handing
                // over. close() clears the overlay, which is what stops the
                // loop rescheduling itself underneath the check-in.
                stop();
                close();
                onCode(hit);
                return;
              }
              // Something was read and it was not ours. Say so and keep
              // looking — the coach's code may be the next frame.
              note.textContent = t("aScanWrong");
            })
            .catch(() => {})
            .then(schedule);
        }

        tick();
      })
      .catch(() => {
        if (!overlay) return;
        shut(t("aScanDenied"));
      });
  }

  return {
    open: open,
    close: close,
    supported: supported,
    readCheckin: readCheckin,
    load: load,
    decodeFrom: decodeFrom,
  };
})();
