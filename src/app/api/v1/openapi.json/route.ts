import { openApiSpec } from "@/lib/api/openapi";

export function GET(req: Request) {
  return Response.json(openApiSpec(new URL(req.url).origin), {
    headers: { "access-control-allow-origin": "*" },
  });
}
