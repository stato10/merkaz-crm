import { apiRoute } from "@/lib/api/handler";
import { ticketsApi } from "@/lib/api/resources";

type P = { id: string };

export const GET = apiRoute<P>({ ticket: ["read"] }, (req, ctx, p) => ticketsApi.get(req, ctx, p.id));
export const PATCH = apiRoute<P>({ ticket: ["update"] }, (req, ctx, p) => ticketsApi.update(req, ctx, p.id));

