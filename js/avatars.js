"use strict";

/* =========================================================================
   WE RUN Coaching — the twelve avatars a member can wear.

   Drawn here, not downloaded. Twelve animated GIFs would be a few hundred
   kilobytes, a licence question each, and a soft blur on a retina screen;
   these are line drawings of a few hundred bytes that stay sharp at any
   size, take the page's own colours in both themes, and get every bit of
   their movement from one shared block of keyframes in assets/app.css — so
   a thirteenth costs a path, not a payload. Nothing here touches the
   network, and there is no image to fetch, resize or compress.

   The ids are a contract with the database: _worker.js/routes/auth.js keeps
   the same twelve and refuses anything else, so an avatar is added in both
   places or it is not added at all.
   ========================================================================= */

const Avatars = (function () {
  /* Everything faces right on a 64x64 field, and the badge that holds it is
     round — so nothing may sit in the corners, and the feet stop short of
     the rim. --av-t is the stride: a hare is quicker on its legs than a
     horse, and a wheel is quicker than either. */
  const open = (t) =>
    // The field is 64 wide; the viewBox is wider on every side, which is the
    // whole margin trick — a round badge cuts the corners off a square, so a
    // horse's nose and a car's front wing need somewhere to be that is not
    // the rim. Everything below is drawn in plain 0-64 coordinates.
    '<svg viewBox="-4 -4 72 72" fill="none" stroke-linecap="round" stroke-linejoin="round"' +
    ' style="--av-t:' + t + '" aria-hidden="true">';

  /* The ground the thing moves over, in the reader's own ink so it is right
     in both themes without a second colour to keep in step. */
  const shadow = '<ellipse cx="31" cy="55" rx="16" ry="2.6" fill="currentColor" opacity=".13"/>';

  /* A limb. av-a and av-b are the same swing half a stride apart, which is
     all it takes to read as running; the origin is the joint it hangs from,
     in the same user units as the path. */
  const limb = (cls, origin, d, color, w) =>
    '<path class="' + cls + '" style="transform-origin:' + origin + '" d="' + d + '"' +
    ' stroke="' + color + '" stroke-width="' + w + '"/>';

  /* ---------- people ------------------------------------------------------ */

  const HAIR = "#241d18";

  /* Six people on one body. What tells them apart is the head, because in a
     thirty-pixel circle the head is the only part with room for a shape of
     its own — a shade of skin or a colour of shirt reads as "a runner", not
     as "that runner". So: a headband, a cap, a beard, a ponytail, a bun,
     hair down the back. */
  function head(o) {
    const hair = o.hair || HAIR;
    const skull = '<circle cx="37.5" cy="16" r="7" fill="' + o.skin + '"/>';
    const crop = '<path d="M30.8 14.4a7.2 7.2 0 0 1 13.2 .3" stroke="' + hair + '" stroke-width="4"/>';
    if (o.style === "band") {
      return skull + crop + '<path d="M31.6 12.8 44 12" stroke="' + o.kit + '" stroke-width="2.6"/>';
    }
    if (o.style === "cap") {
      // A peaked cap swallows the hair, which is the point: no other head here
      // is a solid shape with a bill out front.
      return skull +
        '<path d="M30.7 15.4a6.9 6.9 0 0 1 13.7 -.2z" fill="' + o.kit + '"/>' +
        '<path d="M43.8 14.6h6" stroke="' + o.kit + '" stroke-width="2.6"/>';
    }
    if (o.style === "beard") {
      return skull + crop + '<path d="M32.4 19.4c1.8 3.6 5.6 4.4 8.8 1.8" stroke="' + hair + '" stroke-width="3.4"/>';
    }
    if (o.style === "pony") {
      return skull + crop + limb("av-b", "32px 14px", "M32 13.5c-7.5 1.5-9.5 6-7 11.5", hair, 4.8);
    }
    if (o.style === "bun") {
      return skull + crop + '<circle cx="31.2" cy="10.4" r="3.4" fill="' + hair + '"/>';
    }
    // Loose hair: one heavy stroke down the back, swinging with the stride.
    return skull + crop + limb("av-b", "32px 15px", "M32.5 12.5c-5.5 3-6.5 9.5-4 14", hair, 6.6);
  }

  function runner(o) {
    /* Leggings are a second stroke over the thigh only, on the same joint and
       the same class, so they swing with the leg they are on. */
    const leg = (cls, d, thigh) =>
      limb(cls, "29px 39px", d, o.skin, 5.2) +
      (o.tights ? limb(cls, "29px 39px", thigh, o.shorts, 6.4) : "");
    return (
      open(o.t) + shadow +
      '<g class="av-bob">' +
        /* the far side first, so the near arm and leg draw over it */
        limb("av-b", "33px 26px", "M33 26 24 30l-3-5", o.skin, 4.6) +
        leg("av-b", "M29 39 21 47l-4 4", "M29 39 22.5 45.5") +
        head(o) +
        '<path d="M35.5 23 29 39" stroke="' + o.kit + '" stroke-width="9"/>' +
        '<path d="M29.5 37.5 32 42" stroke="' + o.shorts + '" stroke-width="9.5"/>' +
        limb("av-a", "33px 26px", "M33 26 43 29l2-5", o.skin, 4.6) +
        leg("av-a", "M29 39 38 45l6-1", "M29 39 35.5 43.7") +
      '</g></svg>'
    );
  }

  /* ---------- animals ----------------------------------------------------- */

  /* Four legs off two hips: the far pair swings against the near pair, which
     is what makes a bound rather than a hop. A horse stands taller than a
     hare, so where the hip is and where the foot lands are the animal's to
     say — everything else about the four is the same. */
  function legs(coat, back, front, w, hip, foot) {
    const knee = ((hip + foot) / 2 + 1).toFixed(1);
    const drop = (foot - (hip + foot) / 2 - 1).toFixed(1);
    const leg = (cls, x, out, back2) =>
      limb(cls, x + "px " + hip + "px", "M" + x + " " + hip + " " + (x + out) + " " + knee + "l" + back2 + " " + drop, coat, w);
    return (
      leg("av-b", back, -5, 3) + leg("av-b", front, -4, 4) +
      leg("av-a", back, 4, -3) + leg("av-a", front, 5, 3)
    );
  }

  const TAN = "#d9a441", BROWN = "#8a5a2b", GREY = "#9aa2b1", EYE = "#2b2118";

  const cheetah =
    open(".4s") + shadow +
    '<g class="av-bound">' +
      limb("av-b", "16px 32px", "M16 32c-9 1-11 6-13 12", TAN, 3.4) +
      legs(TAN, 23, 40, 4, 36, 45) +
      '<path d="M23 33h17" stroke="' + TAN + '" stroke-width="14"/>' +
      '<path d="M40 32 46 28" stroke="' + TAN + '" stroke-width="9"/>' +
      '<circle cx="48" cy="26" r="6" fill="' + TAN + '"/>' +
      '<path d="M45 21.5l.5-4 3.5 2.5" stroke="' + TAN + '" stroke-width="3"/>' +
      '<circle cx="50" cy="25" r="1.3" fill="' + EYE + '"/>' +
      '<g fill="#5a3f14" opacity=".65"><circle cx="27" cy="31" r="1.6"/><circle cx="33" cy="34.5" r="1.6"/>' +
      '<circle cx="37" cy="30" r="1.5"/><circle cx="30" cy="37" r="1.4"/></g>' +
    '</g></svg>';

  const horse =
    open(".52s") + shadow +
    '<g class="av-bound">' +
      limb("av-b", "18px 29px", "M18 29c-6 2-7.5 7-7 12", "#5b3a1c", 3.6) +
      legs(BROWN, 24, 40, 4.2, 34, 49) +
      '<path d="M24 31h16" stroke="' + BROWN + '" stroke-width="13"/>' +
      '<path d="M40 31 45.5 22" stroke="' + BROWN + '" stroke-width="8"/>' +
      '<path d="M45.5 21 53 18.5" stroke="' + BROWN + '" stroke-width="5.5"/>' +
      '<path d="M44.5 18l1-4" stroke="' + BROWN + '" stroke-width="2.8"/>' +
      '<path d="M41 26.5c2.5-3.5 3.5-5.5 4-7.5" stroke="#42280f" stroke-width="3.6"/>' +
      '<circle cx="49.5" cy="19.5" r="1.1" fill="' + EYE + '"/>' +
    '</g></svg>';

  const hare =
    open(".34s") + shadow +
    '<g class="av-bound">' +
      legs(GREY, 25, 39, 4, 36, 45) +
      '<path d="M25 34h13" stroke="' + GREY + '" stroke-width="15"/>' +
      '<circle cx="20" cy="32" r="3.4" fill="#e9ecf2"/>' +
      '<circle cx="44" cy="29" r="6.5" fill="' + GREY + '"/>' +
      limb("av-b", "43px 25px", "M43 25c-1.5-6-.5-9 1.5-11", GREY, 3.4) +
      limb("av-a", "45px 25px", "M45 25c1-6 3-8.5 5-10.5", GREY, 3.4) +
      '<circle cx="47" cy="28" r="1.3" fill="' + EYE + '"/>' +
    '</g></svg>';

  /* ---------- cars -------------------------------------------------------- */

  /* Tyre, hub, and three spokes that are the only thing turning: a wheel with
     a cross drawn right across it reads as a gunsight at badge size. */
  function wheel(x, y, r) {
    const hub = r * 0.52;
    let spokes = "";
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3;
      spokes +=
        '<path d="M' + x + " " + y + "l" + (Math.cos(a) * hub).toFixed(1) + " " +
        (Math.sin(a) * hub).toFixed(1) + '"/>';
    }
    return (
      '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#23212e"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + hub.toFixed(1) + '" fill="#c3c7d2"/>' +
      '<g class="av-wheel" style="transform-origin:' + x + 'px ' + y + 'px"' +
        ' stroke="#6b7180" stroke-width="1.4">' + spokes + '</g>'
    );
  }

  /* The air the car is leaving behind, again in the reader's own ink. */
  const zip =
    '<g class="av-zip" stroke="currentColor" stroke-width="2.6" opacity=".38">' +
    '<path d="M3 25h12"/><path d="M1 33h8"/></g>';

  const formula =
    open(".28s") + zip + shadow +
    '<g class="av-bob">' +
      '<path d="M8 29h12v3.4H8z" fill="#e11d48"/>' +
      '<path d="M14 32.4v6" stroke="#e11d48" stroke-width="2.6"/>' +
      /* one outline for the whole car: floor, the hump the driver sits in,
         and the nose tapering away to the front wing */
      '<path d="M10 38h13l3-5h8l4 5h14l7 2.5v5.5H10z" fill="#e11d48"/>' +
      '<path d="M50 47h11v3H50z" fill="#b3123a"/>' +
      '<circle cx="29.5" cy="34.6" r="3.3" fill="#eef0f5"/>' +
      '<path d="M31.2 34h2.6" stroke="#23212e" stroke-width="1.7"/>' +
      wheel(18.5, 46.5, 6.8) + wheel(45, 46.5, 6.8) +
    '</g></svg>';

  const rally =
    open(".3s") + zip + shadow +
    '<g class="av-bob">' +
      '<path d="M7 33h9v3.5H7z" fill="#1d4ed8"/>' +
      '<path d="M8 47v-8l7-2 7-7h14l8 7 12 2v8z" fill="#2563eb"/>' +
      '<path d="M23 32h8v5H17z" fill="#cfe3ff" opacity=".9"/><path d="M33 32h2l5 5h-7z" fill="#cfe3ff" opacity=".9"/>' +
      '<path d="M50 41h5" stroke="#ffd15c" stroke-width="3"/>' +
      wheel(20, 45, 7.5) + wheel(45, 45, 7.5) +
    '</g></svg>';

  const supercar =
    open(".26s") + zip + shadow +
    '<g class="av-bob">' +
      '<path d="M6 47v-5l9-3 11-6h11l13 7 9 3v4z" fill="#f59e0b"/>' +
      '<path d="M25 36l3-4h8l6 4z" fill="#2b2f3a" opacity=".85"/>' +
      '<path d="M7 41h6" stroke="#c2410c" stroke-width="2.5"/><path d="M53.5 42.6h3" stroke="#fff2c2" stroke-width="2.4"/>' +
      wheel(20, 45.5, 7) + wheel(46, 45.5, 7) +
    '</g></svg>';

  /* ---------- the twelve --------------------------------------------------- */

  const ART = {
    m1: runner({ t: ".46s", skin: "#e8b58c", kit: "#e11d48", shorts: "#1f2937", style: "band" }),
    m2: runner({ t: ".44s", skin: "#c98a5b", kit: "#2563eb", shorts: "#0f172a", style: "cap" }),
    m3: runner({ t: ".48s", skin: "#8d5a34", kit: "#10b981", shorts: "#1f2937", style: "beard", hair: "#141110" }),
    f1: runner({ t: ".45s", skin: "#e8b58c", kit: "#8851F4", shorts: "#3b2a63", style: "pony", tights: true }),
    f2: runner({ t: ".47s", skin: "#c98a5b", kit: "#06b6d4", shorts: "#134e4a", style: "bun", tights: true }),
    f3: runner({ t: ".43s", skin: "#8d5a34", kit: "#ec4899", shorts: "#4c1d3d", style: "long", hair: "#141110" }),
    cheetah: cheetah,
    horse: horse,
    hare: hare,
    formula: formula,
    rally: rally,
    supercar: supercar,
  };

  /* Four rows of three, in the order the picker shows them. */
  const GROUPS = [
    { label: "aAvMen", ids: ["m1", "m2", "m3"] },
    { label: "aAvWomen", ids: ["f1", "f2", "f3"] },
    { label: "aAvAnimals", ids: ["cheetah", "horse", "hare"] },
    { label: "aAvCars", ids: ["formula", "rally", "supercar"] },
  ];

  /* What a screen reader says, and what the picker's tooltip shows. */
  const NAME = {
    m1: "aAvManRed", m2: "aAvManBlue", m3: "aAvManGreen",
    f1: "aAvWomanPurple", f2: "aAvWomanTeal", f3: "aAvWomanPink",
    cheetah: "aAvCheetah", horse: "aAvHorse", hare: "aAvHare",
    formula: "aAvFormula", rally: "aAvRally", supercar: "aAvSupercar",
  };

  const IDS = GROUPS.reduce((all, g) => all.concat(g.ids), []);

  return {
    IDS: IDS,
    GROUPS: GROUPS,
    NAME: NAME,
    /** "" is a real answer: a member who picks nothing wears their initial. */
    has: (id) => Object.prototype.hasOwnProperty.call(ART, id),
    svg: (id) => ART[id] || "",
  };
})();
