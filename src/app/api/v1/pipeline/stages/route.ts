import { apiRoute } from "@/lib/api/handler";
import { listPipelineStages } from "@/lib/api/resources";

export const GET = apiRoute({ deal: ["read"] }, (req, ctx) => listPipelineStages(req, ctx));
