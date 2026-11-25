import { execSync } from "node:child_process";
import postgres from "postgres";
import { evalDbUrl } from "./db-url";

/** Fresh eval database every run: schema, RLS setup, and the demo organization. */
export default async function setup() {
  const url = evalDbUrl();
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
  execSync("npx tsx scripts/seed.ts --reset", { env, stdio: "pipe" });
}
