import { config } from "dotenv";

/** The eval database: EVAL_DATABASE_URL, or DATABASE_URL with the db renamed to crm_eval. */
export function evalDbUrl() {
  // Also loads ANTHROPIC_API_KEY for the eval run.
  config({ path: ".env.local", quiet: true });
  if (process.env.EVAL_DATABASE_URL) return process.env.EVAL_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL or EVAL_DATABASE_URL is required for evals");
  const u = new URL(base);
  u.pathname = "/crm_eval";
  return u.toString();
}
