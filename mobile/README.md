# WE RUN Club — phone shell

An Expo app whose whole job is to open https://weruncoaching.pages.dev/app in a
WebView. There is no second copy of the club's screens: the site is the app, so
a deploy to `main` updates the phone app too and nothing here needs rebuilding.

    npm install
    npm start        # then scan the QR with Expo Go

What the shell adds over a browser tab: the club's icon on the home screen, the
Android back button walking the app's own history, camera and location asked for
as native permissions (the scanner and the meeting-point check use the page's own
web APIs, and on Android the WebView only grants what the app itself holds), and
an honest "can't reach it" screen instead of a browser error page.

By default the shell opens production. To point it at `node tools/dev.js --lan`
instead, put the machine's LAN address in `mobile/.env` (gitignored) and restart
Metro with `--clear`, because Expo reads `EXPO_PUBLIC_*` when it bundles:

    EXPO_PUBLIC_WERUN_URL=http://192.168.8.16:4323

Logging in will not stick over a plain-http LAN address: the session cookie is
`Secure` (`_worker.js/lib/auth.js`) and a WebView only treats localhost as a
secure origin. On Android, `adb reverse tcp:4323 tcp:4323` with the phone on USB
makes the dev server *be* localhost and login works; otherwise test signed-in
screens against production.

`npm run check` bundles the app and validates the config; that is the whole test.

Web push does not reach a WebView. Reminders keep arriving on whatever browser
the athlete installed the PWA in; making them native needs `expo-notifications`,
a development build (Expo Go cannot register a push token) and a device-token
branch beside the VAPID one in `_worker.js/lib/push.js`.
