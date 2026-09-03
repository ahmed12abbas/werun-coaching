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

  async load() {
    try {
      const r = await API.get("/api/auth/me");
      Auth.user = r.user || null;
    } catch (e) {
      Auth.user = null;
    }
    return Auth.user;
  },

  async login(email, password) {
    const r = await API.post("/api/auth/login", { email: email, password: password });
    Auth.user = r.user;
    return r.user;
  },

  async signup(name, email, password) {
    const r = await API.post("/api/auth/signup", {
      name: name,
      email: email,
      password: password,
      lang: I18N.lang,
    });
    Auth.user = r.user;
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
