# js/vendor

The one place on this site that ships somebody else's code to a browser.

## jsqr-1.4.0.js

[jsQR](https://github.com/cozmo/jsQR) 1.4.0, Apache-2.0, the published
`dist/jsQR.js` copied **verbatim** from the npm package — diff it against
`node_modules/jsqr/dist/jsQR.js` and it should match byte for byte. The
licence is beside it in `LICENSE-jsqr.txt`.

### Why it is here

`js/scan.js` reads the coach's check-in code with the phone's camera. Where
the browser has `BarcodeDetector` — Android Chrome — it uses that and this
file is never fetched. iOS Safari has no `BarcodeDetector` and a large share
of the club runs iPhones, so without a decoder of our own those athletes were
told to go and open the camera app instead. This is what closes that gap.

It is the same decoder `tools/qr-test.js` already runs `js/qr.js` through, so
the code the coach shows and the code the athlete reads are checked against
one implementation rather than two.

### The rules it lives by

- **Served from this origin, never a CDN.** The site loads no third-party
  script at runtime; vendoring is what keeps that true.
- **Loaded on demand.** `js/scan.js` injects it the first time somebody opens
  the scanner and never on a page that does not. It is 250KB unminified —
  there is no build step here to shrink it, and that is the price of not
  having one.
- **The version is in the filename.** `tools/version-assets.js` stamps
  `<script src="js/…">` tags in the HTML and this is not one, so there is
  nothing to bust: bumping the library renames the file, which is a new URL by
  construction. Update the constant in `js/scan.js` when you do.
- **Never edited.** A patch that has to live here belongs in `js/scan.js`
  around it, or the file stops being checkable against upstream.
