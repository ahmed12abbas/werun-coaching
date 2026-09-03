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
