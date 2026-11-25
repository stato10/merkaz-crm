import { sql } from "drizzle-orm";
import { db } from "./index";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Restricted Postgres role that is subject to row-level security (see scripts/db-setup.ts). */
export const TENANT_ROLE = "crm_tenant";

/**
 * Runs `fn` in a transaction where Postgres itself enforces tenant isolation:
 * the transaction switches to a non-owner role and pins `app.org_id`, so the
 * RLS policies hide every other organization's rows even if a query forgets
 * its `org_id` filter.
 */
export async function withTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    await tx.execute(sql.raw(`set local role ${TENANT_ROLE}`));
    return fn(tx);
  });
}
