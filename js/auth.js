"use strict";

/* =========================================================================
   WE RUN Coaching — who is using the app.

   The Worker knows from the cookie; this is the page's copy of the answer,
   asked for once per load and kept until something changes it. Nothing here
   stores a password or a token: the cookie is HttpOnly, so the page could
   not read it if it tried.
   ========================================================================= */

const Auth = {
  /** undefined until load() has answered; then a user object or null. */
  user: undefined,

  /** The club's own settings, as /api/auth/me hands them over. */
  club: {},

  /** Coaches take the sessions, see /coach, and never meet maintenance. */
  isCoach: () => !!(Auth.user && Auth.user.role === "coach"),

  /* Admins run the club, and are the only ones /admin lets in. Undefined
     until 0010 is applied, and a coach still runs the club in that window —
     which is what the Worker answers too, so the button and the door agree. */
  isAdmin: () => !!(Auth.user && (Auth.user.is_admin === undefined ? Auth.user.role === "coach" : Auth.user.is_admin)),

  async load() {
    try {
      // app.html asks in its <head>, before sixteen scripts have downloaded.
      const early = window.ME_EARLY;
      window.ME_EARLY = null;
      const res = early && (await early);
      const r = res && res.ok ? await res.json() : await API.get("/api/auth/me");
      Auth.user = r.user || null;
      Auth.club = r.club || {};
    } catch (e) {
      Auth.user = null;
    }
    return Auth.user;
  },

  async login(email, password) {
    const r = await API.post("/api/auth/login", { email: email, password: password });
    Auth.user = r.user;
    // The club's settings come back with the login, so the announcement and
    // the maintenance switch are right on the first screen after it rather
    // than only after a reload.
    Auth.club = r.club || {};
    return r.user;
  },

  async signup(name, email, password, about) {
    const r = await API.post("/api/auth/signup", Object.assign({
      name: name,
      email: email,
      password: password,
      lang: I18N.lang,
    }, about || {}));
    Auth.user = r.user;
    Auth.club = r.club || {};
    return r.user;
  },

  async logout(everywhere) {
    try {
      await API.post(everywhere ? "/api/auth/logout-all" : "/api/auth/logout");
    } catch (e) {}
    Auth.user = null;
    // The offline shelf holds this athlete's own week and points. A shared
    // phone at the club is exactly the case logging out is for, so it goes
    // out with them — see sw.js.
    try {
      if (self.caches) caches.delete("werun-data-v1");
    } catch (e) {}
  },

  async update(fields) {
    const r = await API.post("/api/auth/profile", fields);
    Auth.user = r.user;
    return r.user;
  },
};
