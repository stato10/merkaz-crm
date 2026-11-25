import { apiRoute } from "@/lib/api/handler";
import { companiesApi } from "@/lib/api/resources";

type P = { id: string };

export const GET = apiRoute<P>({ company: ["read"] }, (req, ctx, p) => companiesApi.get(req, ctx, p.id));
export const PATCH = apiRoute<P>({ company: ["update"] }, (req, ctx, p) => companiesApi.update(req, ctx, p.id));

