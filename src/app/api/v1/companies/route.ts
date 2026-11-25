import { apiRoute } from "@/lib/api/handler";
import { companiesApi } from "@/lib/api/resources";

export const GET = apiRoute({ company: ["read"] }, (req, ctx) => companiesApi.list(req, ctx));
export const POST = apiRoute({ company: ["create"] }, (req, ctx) => companiesApi.create(req, ctx));
