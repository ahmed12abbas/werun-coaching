/* Responses and requests, the way every route makes and reads them. */

export const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function readBody(request) {
  try {
    const v = await request.json();
    // null, "x", [] and 7 are all valid JSON and none of them is a request
    // body: hand back {} so a route reads missing fields rather than throwing.
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (e) {
    return {}; // a malformed body fails the route's own checks on its own merits
  }
}

/* A field that should hold an object, or {} when it holds anything else. */
export const objectIn = (v) => (v && typeof v === "object" ? v : {});

/* The id of the row a save is writing over, or null when it is a new one. */
export const savedId = (o) => (/^[A-Za-z0-9_-]{1,64}$/.test(String(o.id || "")) ? String(o.id) : null);
