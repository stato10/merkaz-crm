import "server-only";
import { rateLimit } from "../rate-limit";
import { aiConfigured } from "./agent";

/** Per-user and per-organization caps on model calls. The demo is public; the API key is not free. */
export const AI_LIMITS = {
  userPerHour: Number(process.env.AI_USER_LIMIT_PER_HOUR ?? 30),
  orgPerDay: Number(process.env.AI_ORG_LIMIT_PER_DAY ?? 200),
};

export type AiGate = { ok: true } | { ok: false; error: string; status: number };

export async function aiGate(orgId: string, userKey: string): Promise<AiGate> {
  if (!aiConfigured()) {
    return { ok: false, status: 503, error: "סוכן ה-AI עוד לא הוגדר בסביבה הזו (חסר ANTHROPIC_API_KEY)." };
  }
  const user = await rateLimit(`ai:user:${userKey}`, AI_LIMITS.userPerHour, 3600);
  if (!user.allowed) return { ok: false, status: 429, error: "הגעתם למכסת השימוש ב-AI לשעה הקרובה. נסו שוב מאוחר יותר." };
  const org = await rateLimit(`ai:org:${orgId}`, AI_LIMITS.orgPerDay, 86_400);
  if (!org.allowed) return { ok: false, status: 429, error: "הארגון הגיע למכסת השימוש היומית ב-AI." };
  return { ok: true };
}
