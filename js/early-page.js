/* Before first paint, same two keys the app writes (js/i18n.js). */
(function () {
  var r = document.documentElement, th = null, lang = null;
  try { th = localStorage.getItem("werun.theme"); lang = localStorage.getItem("werun.lang"); } catch (e) {}
  if (th === "light" || th === "dark") r.setAttribute("data-theme", th);
  if (lang !== "ar" && lang !== "en") lang = (navigator.language || "").toLowerCase().indexOf("ar") === 0 ? "ar" : "en";
  r.setAttribute("lang", lang);
  r.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
})();
