/**
 * Idempotent database setup that drizzle-kit push does not cover:
 * a restricted role plus row-level security policies on every tenant table.
 *
 *   npx tsx scripts/db-setup.ts
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config();

const ROLE = "crm_tenant";
const tenantTables = [
  "companies",
  "contacts",
  "activities",
  "tickets",
  "ticket_messages",
  "appointments",
  "pipeline_stages",
  "deals",
  "audit_log",
  "webhook_endpoints",
  "webhook_deliveries",
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
          create role ${ROLE} nologin;
        end if;
      end $$;
      grant ${ROLE} to current_user;
      grant usage on schema public to ${ROLE};
    `);

    for (const t of tenantTables) {
      await sql.unsafe(`
        grant select, insert, update, delete on table ${t} to ${ROLE};
        alter table ${t} enable row level security;
        drop policy if exists tenant_isolation on ${t};
        create policy tenant_isolation on ${t}
          using (org_id = current_setting('app.org_id', true))
          with check (org_id = current_setting('app.org_id', true));
      `);
    }

    // Membership lookups (owner/assignee checks) are scoped to the same org.
    await sql.unsafe(`
      grant select on table member to ${ROLE};
      alter table member enable row level security;
      drop policy if exists tenant_isolation on member;
      create policy tenant_isolation on member
        using (organization_id = current_setting('app.org_id', true));

      grant select (id, name, image) on table "user" to ${ROLE};
      grant select (id, name) on table organization to ${ROLE};
      alter table organization enable row level security;
      drop policy if exists tenant_isolation on organization;
      create policy tenant_isolation on organization
        using (id = current_setting('app.org_id', true));
    `);
    console.log(`RLS ready: role ${ROLE}, ${tenantTables.length + 2} tables with tenant_isolation policies`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
