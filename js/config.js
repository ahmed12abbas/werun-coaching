"use strict";

/* =========================================================================
   WE RUN Coaching — the one file you edit after deploying.

   Everything else works with no configuration at all. These settings only
   switch on the "send it straight to my watch" button, which needs the
   Cloudflare Worker in worker/ to be deployed first.
   ========================================================================= */

const CONFIG = {
  /**
   * Base URL of the deployed Cloudflare Worker, with no trailing slash.
   * e.g. "https://werun-connect.<your-subdomain>.workers.dev"
   *
   * Leave "" and the page still works completely — athletes get the typed
   * steps, the .fit file and the text version, just not the one-tap push.
   */
  workerUrl: "",

  /**
   * Set true once the intervals.icu OAuth app has been approved (see
   * README → "Turning on one-tap delivery"). Until then the connect button
   * stays hidden rather than showing athletes something that errors.
   */
  connectEnabled: false,

  /** Shown to athletes on the connect card so they know who they're linking to. */
  clubName: "WE RUN",

  /** Fallback pace units when a link doesn't say. Coaches here talk in min/km. */
  units: "km",
};
