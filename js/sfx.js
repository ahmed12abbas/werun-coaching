"use strict";

/* =========================================================================
   WE RUN Coaching — the three noises the page makes.

   A pop when the Coach Tips cloud comes up, a click for the pace calculator,
   and a detent tick for every number the roller passes under the thumb. All
   three are synthesised on the spot with Web Audio: a handful of oscillators
   costs nothing to download, needs no /assets to keep in step with the
   deploy, and stays perfectly in time with the tap that asked for it — an
   <audio> tag hunting for a file over the network does not.

   Every entry point here is called from a tap, a wheel or a key, which is
   what browsers demand before they will let a page make a sound at all. The
   context is built on that first gesture rather than at load, so a visitor
   who never touches either button never has an audio device opened for them.

   Nothing here throws. On a browser with no Web Audio, or one that refuses
   the context, every call quietly does nothing and the buttons behave
   exactly as they did before there was any sound at all.
   ========================================================================= */

const SFX = (function () {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let dead = false; // no Web Audio here; stop trying
  let lastTick = 0;

  /** The context, built on first use and nudged awake if the tab suspended it. */
  function audio() {
    if (dead) return null;
    if (ctx) {
      // Phones suspend the context when the page goes to the background and
      // hand it back suspended; without this the sound stops for good.
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      dead = true;
      return null;
    }
    try {
      ctx = new AC();
      master = ctx.createGain();
      // Quiet on purpose. This is furniture under a coach's session, not an
      // alert — it should sit under the room an athlete is standing in.
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch (e) {
      dead = true;
      return null;
    }
    return ctx;
  }

  /** A second of white noise, made once and replayed by every burst. */
  function noise(c) {
    if (noiseBuf) return noiseBuf;
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    return buf;
  }

  /**
   * The hard edge of a sound: a slice of noise squeezed through a bandpass.
   * This is what the ear reads as "something was struck" — the tone that
   * follows only says what was struck.
   */
  function burst(at, freq, q, gain, dur) {
    const c = ctx;
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.playbackRate.value = 1;
    // Start somewhere random in the second so repeated ticks are not the
    // literal same waveform over and over, which reads as a loop, not a tick.
    const off = Math.random() * 0.9;

    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = q;

    const g = c.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    src.connect(band).connect(g).connect(master);
    src.start(at, off, dur + 0.02);
    src.stop(at + dur + 0.02);
  }

  /**
   * The body of a sound: one oscillator sliding from `from` to `to`.
   * A rise reads as something opening, a fall as something closing — which
   * is the whole difference between the two halves of the tips button.
   */
  function tone(at, type, from, to, gain, dur) {
    const c = ctx;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + dur);

    const g = c.createGain();
    // A couple of milliseconds of attack, because a gain that jumps from
    // nothing to full in one sample is itself a click, on top of the one
    // we meant.
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  return {
    /** The cloud coming up: a cork out of a bottle, pitch rising. */
    pop() {
      if (!audio()) return;
      const at = ctx.currentTime;
      burst(at, 1100, 1.2, 0.22, 0.02);
      tone(at, "sine", 320, 880, 0.5, 0.11);
    },

    /** The cloud going away: the same shape run downhill, and softer. */
    unpop() {
      if (!audio()) return;
      const at = ctx.currentTime;
      burst(at, 900, 1.2, 0.1, 0.015);
      tone(at, "sine", 660, 240, 0.28, 0.09);
    },

    /** A panel toggling: a switch, not a cork. Same sound either way. */
    click() {
      if (!audio()) return;
      const at = ctx.currentTime;
      burst(at, 2400, 5, 0.3, 0.016);
      tone(at, "triangle", 1500, 700, 0.16, 0.035);
    },

    /**
     * A star going in. Five stars, five notes up a scale, so an athlete
     * hears the rating rise before they have read anything back — and hears
     * at once that the tap landed on the fourth star and not the third.
     */
    star(n) {
      if (!audio()) return;
      const at = ctx.currentTime;
      // C D E G A: a pentatonic run, which has no wrong note in it whichever
      // rating someone picks, and no semitone to sound sour at one star.
      const notes = [523.25, 587.33, 659.25, 783.99, 880];
      const f = notes[Math.max(1, Math.min(5, Math.round(n))) - 1];
      burst(at, 2600, 6, 0.13, 0.012);
      tone(at, "triangle", f, f, 0.2, 0.15);
      // An octave over the top of it, quieter and shorter: that is the whole
      // difference between a note and a chime.
      tone(at, "sine", f * 2, f * 2, 0.07, 0.09);
    },

    /**
     * The theme toggle: a wall switch, which is two sounds and not one — the
     * throw of the lever, then the seat of it a moment later. A single clack
     * is a mouse button; the pair is what makes it a switch on a wall.
     */
    flip() {
      if (!audio()) return;
      const at = ctx.currentTime;
      burst(at, 1900, 2.5, 0.34, 0.012);
      tone(at, "triangle", 950, 380, 0.13, 0.03);
      const seat = at + 0.055;
      burst(seat, 1150, 3.5, 0.2, 0.022);
      tone(seat, "sine", 300, 150, 0.18, 0.05);
    },

    /**
     * One number passing the window on the roller.
     *
     * A flick can throw a dozen of these a second, so they are rate-limited
     * and detuned a little each time: a stream of the identical sample at
     * machine speed stops sounding like a wheel and starts sounding like a
     * fault. Dropping the ones that come too fast is right anyway — a wheel
     * spinning that hard blurs its own detents.
     */
    tick() {
      if (!audio()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.035) return;
      lastTick = now;
      const wobble = 0.9 + Math.random() * 0.2;
      burst(now, 3200 * wobble, 9, 0.16, 0.011);
      tone(now, "square", 1200 * wobble, 900 * wobble, 0.045, 0.018);
    },
  };
})();

/* -------------------------------------------------------------------------
   Every button, once.

   The page rebuilds itself from scratch on every theme flip, language switch
   and re-render, so hanging a sound off each button as it is built would mean
   remembering to do it in thirty places and again in every place added later.
   One listener on the document outlives all of that: whatever button was
   clicked, it was inside something, and closest() finds it.

   It listens in the capture phase so a handler that stops the event — or
   removes its own button from the page, which several here do — still gets
   its click. What a button sounds like is written on the button itself:

     (nothing)            the default click
     data-sfx="flip"      a wall switch, for the theme toggle
     data-sfx="off"       silence: this one plays its own, and two sounds
                          for one tap reads as a stutter

   Links are in, when they are dressed as buttons. To an athlete the .fit
   download is a button; that it happens to be an <a> is our business.
   ------------------------------------------------------------------------- */

document.addEventListener(
  "click",
  (e) => {
    const t = e.target;
    if (!t || !t.closest) return; // a click on the document itself
    const hit = t.closest("button, .btn, [role='button']");
    if (!hit || hit.disabled) return;
    const how = hit.getAttribute("data-sfx");
    if (how === "off") return;
    if (how === "flip") SFX.flip();
    else SFX.click();
  },
  true
);
