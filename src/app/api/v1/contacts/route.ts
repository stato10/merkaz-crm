import { apiRoute } from "@/lib/api/handler";
import { contactsApi } from "@/lib/api/resources";

export const GET = apiRoute({ contact: ["read"] }, (req, ctx) => contactsApi.list(req, ctx));
export const POST = apiRoute({ contact: ["create"] }, (req, ctx) => contactsApi.create(req, ctx));
