import { apiRoute } from "@/lib/api/handler";
import { dealsApi } from "@/lib/api/resources";

type P = { id: string };

export const GET = apiRoute<P>({ deal: ["read"] }, (req, ctx, p) => dealsApi.get(req, ctx, p.id));
export const PATCH = apiRoute<P>({ deal: ["update"] }, (req, ctx, p) => dealsApi.update(req, ctx, p.id));

