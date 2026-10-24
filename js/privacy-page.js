"use strict";
var root = document.documentElement;
var btn = document.getElementById("lang");
function show(lang) {
  root.setAttribute("lang", lang);
  root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  document.getElementById("en").hidden = lang !== "en";
  document.getElementById("ar").hidden = lang !== "ar";
  btn.textContent = lang === "ar" ? "English" : "العربية";
  document.getElementById("back").textContent = lang === "ar" ? "→ WE RUN" : "← WE RUN";
  document.getElementById("socials").setAttribute("aria-label", lang === "ar" ? "WE RUN على منصات التواصل" : "WE RUN on social");
  document.title = (lang === "ar" ? "الخصوصية" : "Privacy") + " · WE RUN";
}
btn.addEventListener("click", function () {
  var next = root.getAttribute("lang") === "ar" ? "en" : "ar";
  try { localStorage.setItem("werun.lang", next); } catch (e) {}
  show(next);
});
show(root.getAttribute("lang") === "ar" ? "ar" : "en");

/* The app's own five links, drawn from its list (SOCIAL in js/brand.js)
   rather than a second copy. */
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
