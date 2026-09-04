/* Does this database have that column yet?

   Migrations here are applied by hand — the deploy's `wrangler d1 migrations
   apply` is skipped, because the API token cannot reach D1 — so code always
   goes live before the schema it was written against. Every release therefore
   has a window where the running Worker is ahead of the database, and code
   that cannot survive that window breaks the club for the length of it.

   So: ask, once per isolate, and write the SQL that fits what is actually
   there. A read costs one PRAGMA on the first request an isolate serves and
   nothing afterwards.

   This is a bridge, not a home. Once a migration is in, the branch it guards
   is dead weight and should come out. */

const known = new Map(); // "table.column" -> boolean

export async function hasColumn(env, table, column) {
  const key = table + "." + column;
  if (known.has(key)) return known.get(key);

  let found = false;
  try {
    // The table name cannot be a bound parameter in a PRAGMA, so it is checked
    // against a strict pattern instead — nothing here ever takes one from a
    // request, and this keeps it that way if someone later tries.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error("bad table name");
    const rows = await env.DB.prepare("SELECT name FROM pragma_table_info(?)").bind(table).all();
    found = (rows.results || []).some((r) => r.name === column);
  } catch (e) {
    console.error("columns: could not read " + key + " (" + (e && e.message) + ")");
  }
  known.set(key, found);
  return found;
}

/** Forget what we learned — for tests that change the schema underneath us. */
export const forgetColumns = () => known.clear();
