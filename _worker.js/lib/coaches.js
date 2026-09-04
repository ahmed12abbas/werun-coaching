/* Who the club's coaches are, and how a session says which one is taking it.

   Deliberately no join to `users`. A week is seven days of slots and
   sessions, and joining every one of them to the members table to fetch four
   names is the wrong shape: the id rides along on rows that are being read
   anyway, and the roster below is one small read the whole week shares.

   It also survived the release this arrived in, when the columns did not yet
   exist — `SELECT s.*` hands back a row without a column it has not got, but
   a `JOIN users ON users.id = s.coach_id` is a statement the database rejects
   outright. That window has closed; the shape is kept because it is right. */

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/* A club has coaches, not hundreds of them. The cap is here because the
   roster is read on every athlete's week — an unbounded SELECT on the busiest
   route in the site is the shape of problem this codebase caps everywhere
   else, and a club that has genuinely passed a hundred coaches wants a
   different screen, not a longer query. */
const CAP = 100;

/** An id a coach could actually have, or "" for "nobody said". */
export const cleanCoachId = (v) => (ID.test(String(v || "")) ? String(v) : "");

/**
 * Just enough to put a name on a session: no email.
 *
 * This is the one that runs on /api/week and /api/session. Nothing it returns
 * reaches an athlete — buildDays turns it into names and drops it — but a
 * roster carrying every coach's address through the club's busiest route is
 * one refactor away from leaking, so it never carries one.
 */
export async function coachRoster(env) {
  const rows = await env.DB.prepare(
    "SELECT id, name FROM users WHERE role = 'coach' AND status <> 'blocked' ORDER BY name ASC LIMIT ?"
  )
    .bind(CAP)
    .all();
  return rows.results || [];
}

/** The same list for the console, which does show the address. */
export async function coachList(env) {
  const rows = await env.DB.prepare(
    "SELECT id, name, email FROM users WHERE role = 'coach' AND status <> 'blocked' ORDER BY name ASC LIMIT ?"
  )
    .bind(CAP)
    .all();
  return rows.results || [];
}

/** id -> name, for putting a name on a row that only carries the id. */
export async function coachNames(env) {
  const by = new Map();
  for (const c of await coachRoster(env)) by.set(c.id, c.name);
  return by;
}

/**
 * The name to show for one session: what it was published under, and only
 * when it says nothing at all, the standing slot's usual coach.
 *
 * A session that names somebody is answered by that name or by nothing — an
 * id belonging to nobody (a coach who has since stopped coaching) must not
 * fall through to the slot, because that would put the club's Tuesday coach
 * on a session a stand-in actually took. Publishing writes the slot's coach
 * into the row when the form is left blank, so the fallback here is for the
 * sessions that went out before any of this existed.
 */
export const coachNameFor = (names, sessionCoachId, slotCoachId) => {
  const own = cleanCoachId(sessionCoachId);
  if (own) return names.get(own) || "";
  return names.get(cleanCoachId(slotCoachId)) || "";
};
