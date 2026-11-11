import { defineMiddleware } from "astro:middleware";
import { isAllowedTunnelRequest, isTunnelRequest } from "./lib/security";

export const onRequest = defineMiddleware((context, next) => {
  if (!isTunnelRequest(context.request)) {
    return next();
  }

  if (isAllowedTunnelRequest(context.request)) {
    return next();
  }

  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
});
