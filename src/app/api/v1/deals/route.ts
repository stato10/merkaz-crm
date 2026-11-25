import { apiRoute } from "@/lib/api/handler";
import { dealsApi } from "@/lib/api/resources";

export const GET = apiRoute({ deal: ["read"] }, (req, ctx) => dealsApi.list(req, ctx));
export const POST = apiRoute({ deal: ["create"] }, (req, ctx) => dealsApi.create(req, ctx));
