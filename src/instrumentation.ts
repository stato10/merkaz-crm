import type { Instrumentation } from "next";

/**
 * Every unhandled server error (pages, server actions, route handlers) lands
 * here as one structured log line with the route and digest, so it can be
 * searched and alerted on. Swap in Sentry/Datadog by forwarding from here.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log } = await import("./lib/log");
  log.error("request.error", {
    err,
    digest: typeof err === "object" && err && "digest" in err ? String(err.digest) : undefined,
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: "renderSource" in context ? context.renderSource : undefined,
  });
};
