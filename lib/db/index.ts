import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

let _db: ReturnType<typeof makeDb> | null = null;

function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}

/** Lazy so that `next build` and unit tests never need a database. */
export function db() {
  if (!_db) _db = makeDb();
  return _db;
}

/** Test seam: lets the integration tests run the real queries against an in-process Postgres. */
export function __useDbForTests(instance: unknown) {
  _db = instance as ReturnType<typeof makeDb>;
}

export { schema };
