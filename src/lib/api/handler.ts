import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { type Tx, withTenant } from "@/db/tenant";
import { type AuditEntry, writeAudit } from "../audit";
import { defer } from "../defer";
import { type Logger, log } from "../log";
import { type Permissions, roleCan, type RoleName } from "../permissions";
import { rateLimit } from "../rate-limit";
import { hashToken, looksLikeApiKey } from "../tokens";

export const RATE_LIMIT = { limit: 120, windowSec: 60 };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);

export type ApiCtx = {
  orgId: string;
  keyId: string;
  /** Acts as the user who created the key, for audit and ownership defaults. */
  actorId: string | null;
  role: RoleName;
  requestId: string;
  log: Logger;
  tx: Tx;
  /** Queue an audit entry; written (and webhooks fired) after the transaction commits. */
  audit: (action: string, target: string, metadata?: Record<string, unknown>) => void;
};

type Handler<P> = (req: NextRequest, ctx: ApiCtx, params: P) => Promise<unknown>;

function problem(status: number, code: string, message: string, requestId: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, request_id: requestId, ...(details ? { details } : {}) } },
    { status, headers: { "x-request-id": requestId } },
  );
}

async function authenticate(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : req.headers.get("x-api-key");
  if (!token || !looksLikeApiKey(token)) return null;
  const [key] = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.hash, hashToken(token)), isNull(schema.apiKeys.revokedAt)))
    .limit(1);
  return key ?? null;
}

/**
 * Wraps a public API route: API-key auth, per-key rate limit, role check,
 * a tenant-scoped RLS transaction, uniform JSON errors and a request log line.
 */
export function apiRoute<P = Record<string, never>>(permission: Permissions | null, handler: Handler<P>) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const started = Date.now();
    let reqLog = log.child({ requestId, method: req.method, path: req.nextUrl.pathname });
    let status = 500;
    let rateHeaders: Record<string, string> = {};
    try {
      const key = await authenticate(req);
      if (!key) {
        status = 401;
        return problem(401, "unauthorized", "Missing or invalid API key", requestId);
      }
      reqLog = reqLog.child({ orgId: key.orgId, keyId: key.id });

      const rl = await rateLimit(`api:${key.id}`, RATE_LIMIT.limit, RATE_LIMIT.windowSec);
      rateHeaders = {
        "ratelimit-limit": String(rl.limit),
        "ratelimit-remaining": String(rl.remaining),
        "ratelimit-reset": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
      };
      if (!rl.allowed) {
        status = 429;
        const res = problem(429, "rate_limited", "Too many requests", requestId);
        for (const [k, v] of Object.entries(rateHeaders)) res.headers.set(k, v);
        res.headers.set("retry-after", rateHeaders["ratelimit-reset"]);
        return res;
      }

      const role = key.role as RoleName;
      if (permission && !roleCan(role, permission)) {
        status = 403;
        return problem(403, "forbidden", "This API key's role does not allow this action", requestId);
      }

      if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
        await defer(() =>
          db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, key.id)),
        );
      }

      const params = await route.params;
      const audits: AuditEntry[] = [];
      const result = await withTenant(key.orgId, (tx) =>
        handler(req, {
          orgId: key.orgId,
          keyId: key.id,
          actorId: key.createdById,
          role,
          requestId,
          log: reqLog,
          tx,
          audit: (action, target, metadata) =>
            audits.push({
              orgId: key.orgId,
              actorId: key.createdById,
              action,
              target,
              metadata: { ...metadata, via: "api", keyId: key.id },
            }),
        }, params),
      );
      for (const a of audits) await writeAudit(a);

      const res = result instanceof Response ? result : NextResponse.json(result);
      status = res.status;
      res.headers.set("x-request-id", requestId);
      for (const [k, v] of Object.entries(rateHeaders)) res.headers.set(k, v);
      return res;
    } catch (e) {
      let res: Response;
      if (e instanceof ApiError) {
        res = problem(e.status, e.code, e.message, requestId, e.details);
      } else if (e instanceof z.ZodError) {
        res = problem(422, "validation_failed", "Request body is invalid", requestId, e.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })));
      } else if (e instanceof SyntaxError) {
        res = problem(400, "invalid_json", "Request body must be valid JSON", requestId);
      } else {
        reqLog.error("api.unhandled", { err: e });
        res = problem(500, "internal_error", "Something went wrong", requestId);
      }
      status = res.status;
      for (const [k, v] of Object.entries(rateHeaders)) res.headers.set(k, v);
      return res;
    } finally {
      reqLog.info("api.request", { status, ms: Date.now() - started });
    }
  };
}

export async function readJson(req: NextRequest) {
  const text = await req.text();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

export function pageParams(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 100);
  return { limit, cursor: sp.get("cursor"), sp };
}
