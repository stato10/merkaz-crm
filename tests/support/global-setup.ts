import { execSync } from "node:child_process";
import postgres from "postgres";
import { testDbUrl } from "./test-db";

/** Create the test database if needed, push the schema and apply the RLS setup. */
export default async function setup() {
  const url = testDbUrl();
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (!exists.length) await admin.unsafe(`create database "${dbName}"`);
  await admin.end();

  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx drizzle-kit push --force", { env, stdio: "pipe" });
  execSync("npx tsx scripts/db-setup.ts", { env, stdio: "pipe" });
}
