import { after } from "next/server";

/**
 * Run work after the response is sent (Next.js `after`). Outside a request
 * scope (scripts, tests, cron) it simply runs now.
 */
export function defer(fn: () => Promise<unknown>) {
  try {
    after(fn);
  } catch {
    return fn();
  }
}
