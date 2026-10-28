import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set (see .env.local)");
}

// HTTP driver: no persistent connection, which suits serverless functions.
export const db = drizzle(neon(url), { schema });
