"use strict";

/* A photo picked in a console, made small enough to keep: at most 1400px
   wide, which a phone photo far exceeds and no card ever shows, so a
   several-MB picture arrives as a couple of hundred KB. Read as a data: URL
   rather than a blob: one, because the site's content policy allows data:
   images and not blob: ones. Safari cannot write WebP from a canvas and hands
   back PNG, several times the size for a photo, so that falls back to JPEG.

   admin.html (the About page, news posts) and tips.html both load this;
   _worker.js/lib/photos.js is the other end. */
function shrinkPhoto(file) {
  return new Promise(function (ok, no) {
    var r = new FileReader();
    r.onerror = function () { no(new Error("Could not read that file.")); };
    r.onload = function () {
      var im = new Image();
      im.onerror = function () { no(new Error("That file is not a photo this browser can open.")); };
      im.onload = function () {
        var s = Math.min(1, 1400 / im.naturalWidth);
        var c = document.createElement("canvas");
        c.width = Math.round(im.naturalWidth * s);
        c.height = Math.round(im.naturalHeight * s);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        var out = c.toDataURL("image/webp", 0.72);
        if (out.indexOf("data:image/webp") !== 0) out = c.toDataURL("image/jpeg", 0.8);
        ok(out);
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
