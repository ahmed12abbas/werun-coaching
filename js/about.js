"use strict";

/* =========================================================================
   The Who Are We page: what is on it, and how it is drawn.

   One document of sections, each { type, show, ...its fields }, with every
   line of text a { en, ar } pair. ABOUT_DEFAULT is the page as first written
   from the July 2026 sponsorship deck (package prices deliberately left out);
   once an admin saves from /admin, GET /api/about hands back their copy.

   Loaded by about.html, which draws it, and by admin.html, whose editor walks
   the same document -- so a field added here turns up in the editor with no
   code there. Everything is written with textContent, never innerHTML, and
   links and photos are checked on the way out, because the words come from
   whoever holds an admin login.
   ========================================================================= */

function aboutPair(en, ar) { return { en: en, ar: ar }; }

var ABOUT_DEFAULT = { sections: [
  { type: "hero", show: true, image: "assets/about/hero.webp",
    kicker: aboutPair("Who are we", "من نحن"),
    title: "WE RUN",
    logo: "assets/logo.png",
    tagline: aboutPair("A Riyadh running community for every level — from a first 5K to a marathon finish line.",
      "مجتمع جري في الرياض لكل المستويات، من أول ٥ كم إلى خط نهاية الماراثون."),
    badge: aboutPair("Most Active CSG · SFA Awards 2025", "المجموعة الأكثر نشاطاً · جوائز الرياضة للجميع ٢٠٢٥") },

  { type: "about", show: true,
    kicker: aboutPair("About WE RUN", "عن WE RUN"),
    lead: aboutPair("We're building a running culture that lasts — getting more people moving across Riyadh and the Kingdom, with a clear focus on empowering women and developing Saudi running talent.",
      "نبني ثقافة جري تدوم، ونزيد النشاط البدني في الرياض وأنحاء المملكة، مع تركيز واضح على تمكين المرأة وتطوير المواهب السعودية في الجري."),
    body: aboutPair("We train with structured, standardised programmes and guidance from regional experts, on a platform open to runners of every level. We push every member toward personal and athletic goals they can measure, and we're building a group that represents Saudi Arabia at national and international events.",
      "نتدرّب وفق برامج منظّمة وموحّدة وبإشراف خبراء من المنطقة، في مساحة مفتوحة للعدّائين من كل المستويات. ندفع كل عضو نحو أهداف شخصية ورياضية قابلة للقياس، ونبني فريقاً يمثّل المملكة في الفعاليات المحلية والدولية."),
    image: "assets/about/award.webp",
    caption: aboutPair("Named the most active Community Sports Group by the Saudi Sports for All Federation, 2025.",
      "حصلنا على لقب المجموعة الرياضية المجتمعية الأكثر نشاطاً من الاتحاد السعودي للرياضة للجميع، ٢٠٢٥.") },

  { type: "stats", show: true,
    title: aboutPair("WE RUN in numbers", "WE RUN بالأرقام"),
    items: [
      { num: "3", label: aboutPair("Seasons", "مواسم") },
      { num: "2800+", label: aboutPair("Members", "عضو") },
      { num: "1200+", label: aboutPair("Sessions", "حصة تدريبية") },
      { num: "9", label: aboutPair("Races", "سباقات") },
      { num: "7", label: aboutPair("Educational workshops", "ورش تثقيفية") },
      { num: "1", label: aboutPair("SFA award", "جائزة من الاتحاد") }
    ] },

  { type: "social", show: true,
    kicker: aboutPair("On social · across all our accounts", "على منصات التواصل · كل حساباتنا"),
    followers_label: aboutPair("Followers", "متابع"),
    // Added up into the followers number. An account with `auto` set is read
    // by the Worker (routes/about.js) and falls back to its typed count. The
    // deck's 17.1K sits under Instagram until the admin splits it.
    // `icon` is an id in SOCIAL (js/brand.js): the chip wears that logo and
    // links where the footer's button does, so neither is a second copy.
    accounts: [
      { name: "Strava", icon: "strava", count: 0, auto: "strava" },
      { name: "Instagram", icon: "instagram", count: 17100, auto: "" },
      { name: "TikTok", icon: "tiktok", count: 11700, auto: "" }, // @werun.sa, 15 Sep 2026
      { name: "X", icon: "x", count: 0, auto: "" }
    ],
    items: [
      { num: "3.1M", label: aboutPair("Views", "مشاهدة") },
      { num: "200K", label: aboutPair("Reach", "وصول") }
    ],
    split_title: aboutPair("Who follows us", "من يتابعنا"),
    men_pct: 56.3,
    men: aboutPair("Men", "رجال"),
    women: aboutPair("Women", "نساء"),
    facts: [
      aboutPair("Mostly 25–34 (50%) and 35–44 (36%)", "أغلبهم بين ٢٥ و٣٤ عاماً (٥٠٪) وبين ٣٥ و٤٤ عاماً (٣٦٪)"),
      aboutPair("Top countries: Saudi Arabia, UAE, Kuwait, Bahrain", "أكثر الدول متابعةً: السعودية، الإمارات، الكويت، البحرين")
    ] },

  { type: "goals", show: true,
    title: aboutPair("What we're here for", "ما نسعى إليه"),
    items: [
      { title: aboutPair("Empower", "تمكين"), text: aboutPair("Empowering women in the community, starting with the first-ever women's performance group.", "تمكين المرأة في المجتمع، بدءاً بتأسيس أول مجموعة أداء نسائية.") },
      { title: aboutPair("Grow", "نموّ"), text: aboutPair("Growing a culture of running and activity in the heart of Riyadh, through events led by running.", "تنمية ثقافة الجري والنشاط في قلب الرياض من خلال فعاليات يقودها الجري.") },
      { title: aboutPair("Represent", "تمثيل"), text: aboutPair("Representing the Saudi identity as a Saudi brand — national day runs, and national and international events.", "تمثيل الهوية السعودية بعلامة سعودية: جريات اليوم الوطني، والمشاركة في الفعاليات المحلية والدولية.") },
      { title: aboutPair("Sustain", "استدامة"), text: aboutPair("Sustaining a community of active, healthy, passionate people through long-term relationships.", "استدامة مجتمع نشيط وصحي وشغوف عبر علاقات طويلة الأمد.") }
    ] },

  // Written out from tools/seed-schedule.js and the pins in tools/places.js
  // as they stood in September 2026. Deliberately a copy the admin edits here
  // rather than a read of the live schedule: this page is public, and what it
  // says about where and when the club meets is the admin's call.
  { type: "sessions", show: true,
    title: aboutPair("Weekly sessions", "حصص الأسبوع"),
    text: aboutPair("Ten sessions a week, Sunday to Saturday — Friday is rest. Come to any of them.",
      "عشر حصص أسبوعياً من الأحد إلى السبت، والجمعة راحة. تعال لأي منها."),
    items: [
      { day: aboutPair("Sunday", "الأحد"), time: aboutPair("4:55 am", "٤:٥٥ ص"), title: aboutPair("Community run", "ركضة مجتمعية"),
        place: aboutPair("Wadi Mahdia Road", "خط التفتيش - بعد الدوار"), map: "https://maps.app.goo.gl/fwSWCrLb9cxV7JHB6" },
      { day: aboutPair("Sunday", "الأحد"), time: aboutPair("7:30 pm", "٧:٣٠ م"), title: aboutPair("Easy run", "ركضة خفيفة"),
        place: aboutPair("Alwaha Park", "حديقة الواحة"), map: "https://maps.app.goo.gl/k28P9vwuudk2CnXC9" },
      { day: aboutPair("Monday", "الاثنين"), time: aboutPair("4:55 am", "٤:٥٥ ص"), title: aboutPair("Easy walk/run", "ركض/مشي خفيف"),
        place: aboutPair("Sports Boulevard", "المسار الرياضي - حطين"), map: "https://maps.app.goo.gl/u6MqqhxKhD6Vhz5b6" },
      { day: aboutPair("Monday", "الاثنين"), time: aboutPair("7:00 pm", "٧:٠٠ م"), title: aboutPair("Speed session", "تمرين سرعات"),
        place: aboutPair("Misk City Track", "مضمار مدينة مسك"), map: "https://maps.app.goo.gl/MzdT2kukz4wjfysA6" },
      { day: aboutPair("Tuesday", "الثلاثاء"), time: aboutPair("4:55 am", "٤:٥٥ ص"), title: aboutPair("Speed session", "تمرين سرعات"),
        place: aboutPair("Wadi Mahdia Road", "خط التفتيش - بعد الدوار"), map: "https://maps.app.goo.gl/fwSWCrLb9cxV7JHB6" },
      { day: aboutPair("Tuesday", "الثلاثاء"), time: aboutPair("7:30 pm", "٧:٣٠ م"), title: aboutPair("Strength session", "تقويات عدائين"),
        place: aboutPair("Alfaisal University", "جامعة الفيصل"), map: "https://maps.app.goo.gl/uV3WdhQKSzL3p5H88" },
      { day: aboutPair("Wednesday", "الأربعاء"), time: aboutPair("4:55 am", "٤:٥٥ ص"), title: aboutPair("Community run", "ركضة مجتمعية"),
        place: aboutPair("Wadi Hanifa Road-Trail", "وادي حنيفة - تريل"), map: "https://maps.app.goo.gl/eDNvfRb281Uf8MTB8" },
      { day: aboutPair("Wednesday", "الأربعاء"), time: aboutPair("7:30 pm", "٧:٣٠ م"), title: aboutPair("Easy run", "ركضة خفيفة"),
        place: aboutPair("Alnahda Park", "حديقة النهضة"), map: "https://maps.app.goo.gl/8ppM7Lp4BanDdANt6" },
      { day: aboutPair("Thursday", "الخميس"), time: aboutPair("4:55 am", "٤:٥٥ ص"), title: aboutPair("Speed session", "تمرين سرعات"),
        place: aboutPair("Wadi Mahdia Road", "خط التفتيش - بعد الدوار"), map: "https://maps.app.goo.gl/fwSWCrLb9cxV7JHB6" },
      { day: aboutPair("Saturday", "السبت"), time: aboutPair("4:55 am", "٤:٥٥ ص"), title: aboutPair("Long run", "ركضة طويلة"),
        place: aboutPair("Wadi Hanifa Park", "حديقة وادي حنيفة"), map: "https://maps.app.goo.gl/iKnDTQNvMCCotjhZ7" }
    ] },

  { type: "gallery", show: true,
    title: aboutPair("Where you've seen us", "من فعالياتنا"),
    // One wide, one tall and six plain tiles fill the grid exactly at both
    // widths; the grid packs densely, so other mixes leave at most one gap.
    items: [
      { image: "assets/about/festival.webp", size: "wide", caption: aboutPair("Riyadh Marathon Festival 2025", "مهرجان ماراثون الرياض ٢٠٢٥") },
      { image: "assets/about/together.webp", size: "tall", caption: aboutPair("Together we run — every week, all year", "معاً نجري، كل أسبوع وطوال العام") },
      { image: "assets/about/race5k.webp", size: "", caption: aboutPair("5K Annual Race 2026", "سباق ٥ كم السنوي ٢٠٢٦") },
      { image: "assets/about/race10k.webp", size: "", caption: aboutPair("10K Annual Race 2025 · Wadi Hanifah", "سباق ١٠ كم السنوي ٢٠٢٥ · وادي حنيفة") },
      { image: "assets/about/workshop.webp", size: "", caption: aboutPair("Riyadh Marathon Workshop 2025", "ورشة ماراثون الرياض ٢٠٢٥") },
      { image: "assets/about/sheruns.webp", size: "", caption: aboutPair("She Runs — women and girls only, with MISK City", "سباق She Runs للنساء والفتيات فقط، بالتعاون مع مدينة مسك") },
      { image: "assets/about/kids.webp", size: "", caption: aboutPair("WE RUN Kids Camp 2025", "معسكر WE RUN للأطفال ٢٠٢٥") },
      { image: "assets/about/games.webp", size: "", caption: aboutPair("Saudi Games Activation 2024", "فعالية دورة الألعاب السعودية ٢٠٢٤") }
    ] },

  { type: "events", show: true,
    title: aboutPair("Coming up", "فعاليات قادمة"),
    items: [
      { day: "10", month: aboutPair("Oct", "أكتوبر"), pink: false, title: aboutPair("10K Race", "سباق ١٠ كم"),
        text: aboutPair("Wadi Hanifah, Riyadh · 1,500 runners, kids' race included", "وادي حنيفة، الرياض · ١٥٠٠ عدّاء، ويشمل سباقاً للأطفال") },
      { day: "24", month: aboutPair("Oct", "أكتوبر"), pink: true, title: aboutPair("She Runs", "She Runs"),
        text: aboutPair("MISK City, Riyadh · 400 runners, women only", "مدينة مسك، الرياض · ٤٠٠ عدّاءة، للنساء فقط") }
    ] },

  // Cropped from the deck's partner slide on its own purple, which is why
  // about.html paints the band that exact colour.
  { type: "partners", show: true,
    title: aboutPair("Our partners", "شركاؤنا"),
    text: aboutPair("Brands, universities and public bodies we've run alongside.",
      "علامات تجارية وجامعات وجهات حكومية جرينا معها."),
    items: [
      { image: "assets/about/partner-joe.webp", name: "Joe & The Juice" },
      { image: "assets/about/partner-calo.webp", name: "CALO" },
      { image: "assets/about/partner-ghiam.webp", name: "GHIAM" },
      { image: "assets/about/partner-nike.webp", name: "Nike" },
      { image: "assets/about/partner-echo.webp", name: "ECHO" },
      { image: "assets/about/partner-rare.webp", name: "RARE" },
      { image: "assets/about/partner-alfaisal.webp", name: "Alfaisal University" },
      { image: "assets/about/partner-ministry.webp", name: "Ministry of Sport" },
      { image: "assets/about/partner-boulevard.webp", name: "Sports Boulevard" }
    ] },

  { type: "cta", show: true, image: "assets/about/park.webp",
    title: aboutPair("Run with us", "اجرِ معنا"),
    text: aboutPair("Ten sessions a week across Riyadh, and every level is welcome. Brands who want to be part of the season — we'd love to hear from you.",
      "عشر حصص أسبوعياً في أنحاء الرياض، وكل المستويات مرحّب بها. وللعلامات التي تريد أن تكون جزءاً من الموسم: يسعدنا تواصلكم."),
    buttons: [
      { label: aboutPair("Join the club", "انضم إلى النادي"), href: "/app.html", primary: true },
      { label: aboutPair("Partner with us", "كن شريكاً لنا"), href: "mailto:werunksa@gmail.com?subject=Partnering%20with%20WE%20RUN", primary: false },
      { label: aboutPair("@werun.sa", "@werun.sa"), href: "https://www.instagram.com/werun.sa/", primary: false }
    ] }
] };

/* Sections the original page does not have, which /admin can add. */
var ABOUT_EXTRA = [
  { type: "text", show: true, title: aboutPair("", ""), body: aboutPair("", ""), image: "" }
];

var aboutRender = (function () {
  /* A photo is one of ours or one uploaded through /admin; the page's content
     policy would refuse anything else anyway, but a broken tile is worse than
     none. A link is a page here, https, or mail -- never javascript:. */
  var PHOTO = /^(assets\/[\w\/.-]+\.(webp|jpe?g|png|svg)|\/api\/about\/img\?id=[a-f0-9]{32})$/;
  var LINK = /^(https:\/\/|mailto:|\/(?!\/))/;

  function tx(v, lang) {
    if (v && typeof v === "object") return String(v[lang] || v.en || "");
    return v == null ? "" : String(v);
  }
  function list(v) { return Array.isArray(v) ? v : []; }

  function h(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    for (var i = 2; i < arguments.length; i++) put(n, arguments[i]);
    return n;
  }
  function put(n, c) {
    if (c == null || c === "") return;
    if (Array.isArray(c)) c.forEach(function (x) { put(n, x); });
    else n.append(c);
  }
  /* An element only when it has something to say. */
  function opt(tag, cls, text) { return text ? h(tag, cls, text) : null; }
  function paras(text, cls) {
    return text.split(/\n\s*\n/).map(function (p) { return opt("p", cls, p.trim()); });
  }
  function img(src, eager, alt) {
    src = String(src || "");
    if (!PHOTO.test(src)) return null;
    var i = document.createElement("img");
    i.src = src;
    i.alt = alt || "";
    i.decoding = "async";
    if (!eager) i.loading = "lazy";
    return i;
  }

  var DRAW = {
    hero: function (s, L) {
      // The team's own mark when there is one, with the title as its alt text
      // so the heading still reads "WE RUN"; the plain title otherwise.
      var mark = img(s.logo, true, tx(s.title, L) || "WE RUN");
      return h("header", "hero", img(s.image, true),
        h("div", "in", opt("div", "kicker", tx(s.kicker, L)),
          mark ? h("h1", "logo", mark) : opt("h1", "", tx(s.title, L)),
          opt("p", "", tx(s.tagline, L)), opt("span", "badge", tx(s.badge, L))));
    },
    about: function (s, L) {
      var pic = img(s.image);
      return h("section", "about" + (pic ? "" : " solo"),
        h("div", "", opt("div", "kicker", tx(s.kicker, L)), opt("p", "lead", tx(s.lead, L)), paras(tx(s.body, L), "muted")),
        pic ? h("figure", "award", pic, opt("figcaption", "", tx(s.caption, L))) : null);
    },
    stats: function (s, L) {
      return h("section", "", opt("h2", "", tx(s.title, L)),
        h("div", "stats", list(s.items).map(function (it) {
          return h("div", "stat", h("div", "num", tx(it.num, L)), opt("div", "lbl", tx(it.label, L)));
        })));
    },
    social: function (s, L, live) {
      var men = Math.max(0, Math.min(100, Number(s.men_pct) || 0));
      var split = null;
      if (men) {
        var a = Math.round(men), b = 100 - a;
        var bar = h("div", "split", h("i"), h("i"));
        bar.firstChild.style.width = men + "%";
        bar.lastChild.style.width = (100 - men) + "%";
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", tx(s.men, L) + " " + a + "%, " + tx(s.women, L) + " " + b + "%");
        split = h("div", "", opt("div", "lbl", tx(s.split_title, L)), bar,
          h("div", "legend", h("span", "", h("b", "", a + "%"), tx(s.men, L)), h("span", "", h("b", "", b + "%"), tx(s.women, L))));
      }
      // Every account in one number: one that is read by itself counts what
      // was read, or what was typed until it has been.
      var total = 0, plats = [];
      list(s.accounts).forEach(function (a) {
        var got = a.auto && live && typeof live[a.auto] === "number" ? live[a.auto] : Number(a.count) || 0;
        total += got;
        plats.push(plat(a, got, L));
      });
      var stats = list(s.items).map(function (it) {
        return h("div", "", h("div", "num", tx(it.num, L)), opt("div", "lbl", tx(it.label, L)));
      });
      if (Array.isArray(s.accounts)) {
        stats.unshift(h("div", "", h("div", "num", compact(total)), opt("div", "lbl", tx(s.followers_label, L))));
      }
      return h("section", "band", opt("div", "kicker", tx(s.kicker, L)),
        h("div", "row", stats),
        plats.length ? h("div", "plats", plats) : null,
        split,
        h("div", "facts", list(s.facts).map(function (f) { return opt("div", "", tx(f, L)); })));
    },
    goals: function (s, L) {
      return h("section", "", opt("h2", "", tx(s.title, L)),
        h("div", "goals", list(s.items).map(function (it, i) {
          return h("div", "goal", h("div", "n", String(i + 1).padStart(2, "0")),
            opt("h3", "", tx(it.title, L)), opt("p", "", tx(it.text, L)));
        })));
    },
    sessions: function (s, L) {
      // Small tiles that say when; one dialog for the section that says the
      // rest. The pop and its reverse are js/sfx.js's, where it is loaded.
      var sfx = typeof SFX !== "undefined" ? SFX : null;
      var box = h("div", "in");
      var dlg = h("dialog", "sess-dlg", box);
      function shut() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
      // A tap on the dim backdrop lands on the dialog itself, outside .in.
      dlg.addEventListener("click", function (e) { if (e.target === dlg) shut(); });
      dlg.addEventListener("close", function () { if (sfx) sfx.unpop(); });
      function open(it) {
        var x = h("button", "x", "×");
        x.type = "button";
        x.setAttribute("data-sfx", "off"); // the close event makes the sound
        x.setAttribute("aria-label", L === "ar" ? "إغلاق" : "Close");
        x.addEventListener("click", shut);
        var map = String(it.map || ""), pin = null;
        if (map.indexOf("https://") === 0) {
          pin = h("a", "btn map", L === "ar" ? "افتح الموقع في الخرائط" : "Open in Maps");
          pin.href = map;
          pin.rel = "noopener noreferrer";
        }
        box.textContent = "";
        box.append(x);
        put(box, [opt("div", "day", tx(it.day, L)), opt("div", "time", tx(it.time, L)),
          opt("h3", "", tx(it.title, L)), opt("p", "place", tx(it.place, L)), pin]);
        if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
        if (sfx) sfx.pop();
      }
      return h("section", "", opt("h2", "", tx(s.title, L)), opt("p", "muted", tx(s.text, L)),
        h("div", "sessions", list(s.items).map(function (it) {
          var b = h("button", "sess", opt("span", "day", tx(it.day, L)), opt("span", "time", tx(it.time, L)),
            opt("span", "what", tx(it.title, L)));
          b.type = "button";
          b.setAttribute("data-sfx", "off"); // opening plays its own pop
          b.setAttribute("aria-haspopup", "dialog");
          b.addEventListener("click", function () { open(it); });
          return b;
        })),
        dlg);
    },
    gallery: function (s, L) {
      return h("section", "", opt("h2", "", tx(s.title, L)),
        h("div", "gallery", list(s.items).map(function (it) {
          var p = img(it.image);
          return p ? h("figure", /^(wide|tall)$/.test(it.size) ? it.size : "", p, opt("figcaption", "", tx(it.caption, L))) : null;
        })));
    },
    events: function (s, L) {
      return h("section", "", opt("h2", "", tx(s.title, L)),
        h("div", "events", list(s.items).map(function (it) {
          return h("div", "event" + (it.pink ? " pink" : ""),
            h("div", "date", h("b", "", tx(it.day, L)), opt("span", "", tx(it.month, L))),
            h("div", "", opt("h3", "", tx(it.title, L)), opt("p", "", tx(it.text, L))));
        })));
    },
    partners: function (s, L) {
      return h("section", "partners", opt("h2", "", tx(s.title, L)), opt("p", "", tx(s.text, L)),
        h("div", "logos", list(s.items).map(function (it) {
          // A logo is the partner's name, so the name is its alt text.
          var p = img(it.image, false, tx(it.name, L));
          return p ? h("div", "", p) : null;
        })));
    },
    text: function (s, L) {
      return h("section", "textsec", opt("h2", "", tx(s.title, L)), paras(tx(s.body, L)), img(s.image));
    },
    cta: function (s, L) {
      return h("section", "cta", img(s.image),
        h("div", "in", opt("h2", "", tx(s.title, L)), opt("p", "", tx(s.text, L)),
          h("div", "btns", list(s.buttons).map(function (b) {
            var href = String(b.href || ""), label = tx(b.label, L);
            if (!label || !LINK.test(href)) return null;
            var a = h("a", "btn " + (b.primary ? "primary" : "ghost"), label);
            a.href = href;
            // "@werun.sa" in an Arabic page would otherwise read "werun.sa@".
            a.dir = "auto";
            if (href.indexOf("https:") === 0) a.rel = "noopener noreferrer";
            return a;
          }))));
    }
  };

  /* One account as a chip: its logo and link from SOCIAL (js/brand.js, which
     only about.html loads), and its number once there is one. The svg is
     ours; the admin's `icon` only picks which. No such logo, and the chip is
     its name instead. */
  function plat(a, got, L) {
    var soc = typeof SOCIAL !== "undefined" ? SOCIAL.filter(function (x) { return x.id === a.icon; })[0] : null;
    var name = tx(a.name, L);
    var chip = h(soc ? "a" : "span", "plat");
    if (soc) {
      chip.href = soc.href;
      chip.target = "_blank";
      chip.rel = "noopener noreferrer";
      var ic = h("span", "ic");
      ic.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + soc.svg + "</svg>";
      chip.append(ic);
    } else {
      chip.append(name);
    }
    if (got) chip.append(h("b", "", compact(got)));
    chip.title = name;
    chip.setAttribute("aria-label", name + (got ? ", " + compact(got) : ""));
    return chip;
  }

  /* 17100 -> "17.1K", the way the deck wrote it. */
  function compact(n) {
    if (n >= 1e6) return +(n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return +(n / 1e3).toFixed(1) + "K";
    return String(n);
  }

  /* `live` is what GET /api/about read by itself: { strava }. */
  return function (root, doc, lang, live) {
    root.textContent = "";
    list(doc && doc.sections).forEach(function (s) {
      if (s && s.show !== false && DRAW[s.type]) root.append(DRAW[s.type](s, lang, live));
    });
  };
})();
