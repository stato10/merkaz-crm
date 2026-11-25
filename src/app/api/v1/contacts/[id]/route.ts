import { apiRoute } from "@/lib/api/handler";
import { contactsApi } from "@/lib/api/resources";

type P = { id: string };

export const GET = apiRoute<P>({ contact: ["read"] }, (req, ctx, p) => contactsApi.get(req, ctx, p.id));
export const PATCH = apiRoute<P>({ contact: ["update"] }, (req, ctx, p) => contactsApi.update(req, ctx, p.id));
export const DELETE = apiRoute<P>({ contact: ["delete"] }, (req, ctx, p) => contactsApi.remove(req, ctx, p.id));
