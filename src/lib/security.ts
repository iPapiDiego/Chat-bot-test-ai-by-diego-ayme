const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const TUNNEL_HEADERS = ["cf-connecting-ip", "cf-ray", "x-forwarded-for", "cf-visitor"];

export const CALLBACK_PATH = /^\/api\/callback\/[^/]+\/?$/;

function stripPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  return host.replace(/:\d+$/, "");
}

function isLoopbackAddress(value: string): boolean {
  const ip = value.trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
  return ip === "::1" || ip === "127.0.0.1" || /^127\./.test(ip);
}

export function isTunnelRequest(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host || !LOCAL_HOSTS.has(stripPort(host.trim().toLowerCase()))) {
    return true;
  }

  for (const name of TUNNEL_HEADERS) {
    const value = request.headers.get(name);
    if (value === null) continue;
    // El dev server de Cloudflare sintetiza cf-connecting-ip con la IP local en
    // cada peticion; solo lo tratamos como tunel si la IP no es loopback.
    if (name === "cf-connecting-ip" && isLoopbackAddress(value)) continue;
    return true;
  }

  return false;
}

export function isAllowedTunnelRequest(request: Request): boolean {
  if (request.method !== "POST") return false;
  return CALLBACK_PATH.test(new URL(request.url).pathname);
}
