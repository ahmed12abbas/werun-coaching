"use strict";
/* The Pink Run/Walk sign-up (pink.html). Its own two-language table rather
   than js/i18n.js: the page is a one-off for a guest audience, and loading
   the app's whole string table for twenty lines would be the wrong trade. */
var PINK = {
  en: {
    title: "Pink Run/Walk",
    sub: "3 km run or walk for Breast Cancer Awareness Month. Free, and everyone is welcome.",
    whenL: "When", when: "Monday 26 October",
    warmL: "Warm-up starts", warm: "5:20 AM",
    whereL: "Meeting point", where: "Sports Boulevard – Hittin", map: "📍 Open in Maps",
    name: "Full name", phone: "Mobile number", email: "Email", optional: "(optional)",
    age: "Age group", choose: "Choose…", u18: "Under 18",
    people: "How many people, including you?",
    first: "Is this your first time running with us?", yes: "Yes", no: "No",
    "bad-first": "Please say if this is your first time with us.",
    send: "Register", sending: "Registering…",
    privacy: "We use your details only to organise this event.",
    doneT: "You're in!", doneP: "See you Monday at Sports Boulevard. Warm-up starts at 5:20 AM.",
    with: "In partnership with Sports Boulevard",
    "bad-name": "Please write your name.",
    "bad-phone": "Please check your mobile number.",
    "bad-email": "That email doesn't look right.",
    "bad-age": "Please choose your age group.",
    "bad-people": "Please choose how many people.",
    "too-often": "Too many tries. Wait a minute and try again.",
    closed: "Registration has closed.",
    fail: "Something went wrong. Please try again.",
    full: "Not enough places left for that many people.",
    "not-open": "Registration isn't open yet.",
    left: "{n} of {cap} places left",
    preview: "Preview: only admins see this form until registration is opened.",
    soonT: "Registration opens soon", soonP: "Check back shortly, or follow @werun.sa on Instagram to hear the moment it opens.",
    fullT: "We're full", fullP: "Every place is taken. Thank you for the love! See you on the next run.",
    closedT: "Registration has closed", closedP: "Thank you to everyone who came out in pink."
  },
  ar: {
    title: "الجري / المشي الوردي",
    sub: "جري أو مشي لمسافة ٣ كم بمناسبة شهر التوعية بسرطان الثدي. مجاني ومفتوح للجميع.",
    whenL: "الموعد", when: "الإثنين ٢٦ أكتوبر",
    warmL: "بداية الإحماء", warm: "٥:٢٠ صباحاً",
    whereL: "نقطة التجمع", where: "المسار الرياضي - حطين", map: "📍 افتح في الخرائط",
    name: "الاسم الكامل", phone: "رقم الجوال", email: "البريد الإلكتروني", optional: "(اختياري)",
    age: "الفئة العمرية", choose: "اختر…", u18: "أقل من ١٨",
    people: "عدد المشاركين (بما فيهم أنت)",
    first: "هل هذه أول مرة تجري معنا؟", yes: "نعم", no: "لا",
    "bad-first": "أخبرنا هل هذه أول مرة تجري معنا.",
    send: "سجّل", sending: "جارٍ التسجيل…",
    privacy: "نستخدم بياناتك لتنظيم هذه الفعالية فقط.",
    doneT: "تم تسجيلك!", doneP: "نراك يوم الإثنين في المسار الرياضي. يبدأ الإحماء ٥:٢٠ صباحاً.",
    with: "بالتعاون مع المسار الرياضي",
    "bad-name": "اكتب اسمك من فضلك.",
    "bad-phone": "تأكد من رقم الجوال.",
    "bad-email": "البريد الإلكتروني غير صحيح.",
    "bad-age": "اختر فئتك العمرية.",
    "bad-people": "اختر عدد المشاركين.",
    "too-often": "محاولات كثيرة. انتظر دقيقة ثم حاول مجدداً.",
    closed: "انتهى التسجيل.",
    fail: "حدث خطأ. حاول مرة أخرى.",
    full: "الأماكن المتبقية لا تكفي لهذا العدد.",
    "not-open": "التسجيل لم يُفتح بعد.",
    left: "تبقّى {n} من {cap} مقعداً",
    preview: "معاينة: هذا النموذج يظهر للمشرفين فقط حتى يُفتح التسجيل.",
    soonT: "التسجيل يفتح قريباً", soonP: "عد بعد قليل، أو تابع ‎@werun.sa على إنستغرام لتعرف لحظة فتحه.",
    fullT: "اكتمل العدد", fullP: "تم حجز جميع الأماكن. شكراً لحبكم! نراكم في الجرية القادمة.",
    closedT: "انتهى التسجيل", closedP: "شكراً لكل من شاركنا باللون الوردي."
  }
};

var root = document.documentElement;
var form = document.getElementById("form");
var err = document.getElementById("err");
var go = form.querySelector(".go");
var lang = root.getAttribute("lang") === "ar" ? "ar" : "en";
var t = function (k) { return PINK[lang][k] || PINK.en[k] || k; };

for (var i = 1; i <= 10; i++) form.people.append(new Option(String(i), String(i)));

function show(next) {
  lang = next;
  root.setAttribute("lang", lang);
  root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  document.querySelectorAll("[data-t]").forEach(function (n) { n.textContent = t(n.dataset.t); });
  document.getElementById("lang").textContent = lang === "ar" ? "English" : "العربية";
  document.title = t("title") + " · WE RUN";
  document.getElementById("socials").setAttribute("aria-label", lang === "ar" ? "WE RUN على منصات التواصل" : "WE RUN on social");
  if (!err.hidden && err.dataset.code) err.textContent = t(err.dataset.code);
  paint();
}

function fail(code) {
  err.dataset.code = PINK.en[code] ? code : "fail";
  err.textContent = t(err.dataset.code);
  err.hidden = false;
}

/* What /api/pink said: { open, preview, closed, cap, taken }. null until it
   answers, and left null if it never does — then the form shows, and the
   server is still the one that says yes or no. */
var STATUS = null;
var loaded = false; // the form waits for the answer, so a shut page never flashes it
var registered = false;
try { registered = localStorage.getItem("werun.pink") === "1"; } catch (e) {}

function done() {
  registered = true;
  paint();
}

/* Which one card the page shows: their confirmation, the form, or why not. */
function paint() {
  var s = STATUS;
  var why = registered ? null
    : s && s.closed ? "closed"
    : s && !s.open && !s.preview ? "soon"
    : s && s.taken >= s.cap ? "full"
    : null;
  form.hidden = !loaded || registered || !!why;
  document.getElementById("done").hidden = !registered;
  document.getElementById("state").hidden = !why;
  if (why) {
    document.getElementById("stateT").textContent = t(why + "T");
    document.getElementById("stateP").textContent = t(why + "P");
  }
  document.getElementById("preview").hidden = !(s && s.preview) || registered;

  var spots = document.getElementById("spots");
  spots.hidden = !s || !s.cap || why === "soon" || why === "closed";
  if (!spots.hidden) {
    var left = Math.max(0, s.cap - s.taken);
    document.getElementById("spotsText").textContent = t("left").replace("{n}", left).replace("{cap}", s.cap);
    document.getElementById("spotsBar").style.width = Math.min(100, (s.taken / s.cap) * 100) + "%";
  }
}

document.getElementById("lang").addEventListener("click", function () {
  var next = lang === "ar" ? "en" : "ar";
  try { localStorage.setItem("werun.lang", next); } catch (e) {}
  show(next);
});

form.addEventListener("submit", function (e) {
  e.preventDefault();
  err.hidden = true;
  if (!form.name.value.trim()) return fail("bad-name");
  if (!form.phone.value.trim()) return fail("bad-phone");
  if (!form.age.value) return fail("bad-age");
  if (!form.first.value) return fail("bad-first");
  go.disabled = true;
  go.textContent = t("sending");
  fetch("/api/pink", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: form.name.value, phone: form.phone.value, email: form.email.value.trim(),
      age: form.age.value, people: Number(form.people.value), first: form.first.value
    })
  }).then(function (res) {
    return res.json()["catch"](function () { return {}; }).then(function (d) {
      // Every answer about places carries the latest count; keep the bar true.
      if (STATUS && d.taken != null) { STATUS.taken = d.taken; STATUS.cap = d.cap; }
      if (d.error === "not-open" && STATUS) STATUS.open = STATUS.preview = false;
      if (!res.ok || !d.ok) throw new Error(d.error || "fail");
    });
  }).then(function () {
    try { localStorage.setItem("werun.pink", "1"); } catch (e) {}
    done();
  })["catch"](function (e) {
    fail(e.message);
    paint();
  }).then(function () {
    go.disabled = false;
    go.textContent = t("send");
  });
});

/* The app's own social links, from SOCIAL in js/brand.js, as /privacy does. */
SOCIAL.forEach(function (s) {
  var a = document.createElement("a");
  a.href = s.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = s.label;
  a.setAttribute("aria-label", s.label);
  a.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + s.svg + "</svg>";
  document.getElementById("socials").append(a);
});

/* The photo behind the page drifts up a little as you scroll, slower than the
   page (pink.html, body::before). At most a fifth of the screen, which is how
   much extra the layer is drawn below the fold. Still for reduced motion. */
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      root.style.setProperty("--shift", Math.min(scrollY * 0.15, innerHeight * 0.2).toFixed(1));
    });
  }, { passive: true });
}

show(lang);
fetch("/api/pink/status", { credentials: "same-origin" })
  .then(function (res) { return res.ok ? res.json() : null; })
  .then(function (d) { STATUS = d && d.cap ? d : null; })["catch"](function () {})
  .then(function () { loaded = true; paint(); });
