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

  /** Coaches see the console and are never held out by maintenance. */
  isCoach: () => !!(Auth.user && Auth.user.role === "coach"),

  async load() {
    try {
      const r = await API.get("/api/auth/me");
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
  },

  async update(fields) {
    const r = await API.post("/api/auth/profile", fields);
    Auth.user = r.user;
    return r.user;
  },
};
