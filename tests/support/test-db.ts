import { config } from "dotenv";

/** The integration-test database: TEST_DATABASE_URL, or DATABASE_URL with the db renamed to crm_test. */
export function testDbUrl() {
  config({ path: ".env.local", quiet: true });
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL or TEST_DATABASE_URL is required for integration tests");
  const u = new URL(base);
  u.pathname = "/crm_test";
  return u.toString();
}
