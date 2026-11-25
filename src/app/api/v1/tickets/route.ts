import { apiRoute } from "@/lib/api/handler";
import { ticketsApi } from "@/lib/api/resources";

export const GET = apiRoute({ ticket: ["read"] }, (req, ctx) => ticketsApi.list(req, ctx));
export const POST = apiRoute({ ticket: ["create"] }, (req, ctx) => ticketsApi.create(req, ctx));
