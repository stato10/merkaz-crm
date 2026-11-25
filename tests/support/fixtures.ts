import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db, schema } from "@/db";
import { generateApiKey } from "@/lib/tokens";

export type Tenant = { orgId: string; userId: string; key: string };

/** A fresh organization with an owner and an API key of the given role. */
export async function createTenant(name: string, role = "admin"): Promise<Tenant> {
  const suffix = randomUUID().slice(0, 8);
  const userId = `u_${suffix}`;
  const orgId = `o_${suffix}`;
  await db.insert(schema.user).values({ id: userId, name: `${name} owner`, email: `${suffix}@test.local` });
  await db.insert(schema.organization).values({ id: orgId, name, slug: `${name.toLowerCase()}-${suffix}` });
  await db.insert(schema.member).values({ id: `m_${suffix}`, organizationId: orgId, userId, role: "owner" });
  const key = await addKey(orgId, userId, role);
  return { orgId, userId, key };
}

export async function addKey(orgId: string, userId: string, role: string) {
  const k = generateApiKey();
  await db.insert(schema.apiKeys).values({ orgId, name: `test ${role}`, prefix: k.prefix, hash: k.hash, role, createdById: userId });
  return k.token;
}

type RouteFn = (req: NextRequest, ctx: { params: Promise<never> }) => Promise<Response>;

/** Invoke a route handler the way Next.js does, with an API key. */
export async function call(
  handler: unknown,
  opts: { key?: string; method?: string; path?: string; body?: unknown; params?: Record<string, string> } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.key) headers.set("authorization", `Bearer ${opts.key}`);
  const req = new NextRequest(new URL(opts.path ?? "/api/v1/test", "http://localhost"), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const res = await (handler as RouteFn)(req, { params: Promise.resolve(opts.params ?? {}) as Promise<never> });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}
