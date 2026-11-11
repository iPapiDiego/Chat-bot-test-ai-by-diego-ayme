import type { APIRoute } from "astro";
import type { PayloadMode } from "../../lib/config";
import { isTunnelRequest } from "../../lib/security";
import { buildPayload, extractReply, validateTarget, type ChatTurn } from "../../lib/webhook";

export const prerender = false;

const MAX_BODY_BYTES = 128 * 1024;
const MAX_UPSTREAM_CHARS = 64 * 1024;

export const POST: APIRoute = async ({ request }) => {
  if (isTunnelRequest(request)) {
    return json({ ok: false, error: "El proxy no está disponible a través del túnel." }, 403);
  }

  const started = performance.now();

  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "El cuerpo de la petición no es JSON válido." }, 400);
  }

  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  const allowPrivate =
    import.meta.env.MODE === "development" || import.meta.env.ALLOW_PRIVATE_TARGETS === "true";
  const { url, error: urlError } = validateTarget(rawUrl, allowPrivate);

  if (!url) {
    return json({ ok: false, error: urlError }, 400);
  }

  const message = typeof input.message === "string" ? input.message : "";
  if (!message.trim()) {
    return json({ ok: false, error: "El mensaje está vacío." }, 400);
  }

  const history: ChatTurn[] = Array.isArray(input.history)
    ? (input.history as ChatTurn[]).filter(
        (turn) => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string",
      )
    : [];

  const timeoutMs = clampNumber(input.timeoutMs, 2000, 120000, 30000);
  const payloadMode: PayloadMode =
    input.payloadMode === "openai" ? "openai" : input.payloadMode === "sellly" ? "sellly" : "simple";
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : "demo";
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey : "";
  const publicBase = typeof input.publicBase === "string" ? input.publicBase.trim() : "";
  const executionId = typeof input.executionId === "string" ? input.executionId.trim() : "";
  const conversationId = typeof input.conversationId === "string" ? input.conversationId : "";
  const contactId = typeof input.contactId === "string" ? input.contactId : "";
  const contactExternalId = typeof input.contactExternalId === "string" ? input.contactExternalId : "";

  const isSellly = payloadMode === "sellly";
  if (isSellly) {
    if (!publicBase) {
      return json({ ok: false, error: "Falta la URL pública del rig para el callback." }, 400);
    }
    if (!executionId) {
      return json({ ok: false, error: "Falta el executionId para el modo Sellly AI." }, 400);
    }
  }

  const payload = buildPayload(payloadMode, {
    message,
    history,
    model,
    sessionId,
    executionId,
    publicBase,
    apiKey,
    conversationId,
    contactId,
    contactExternalId,
  });

  const body = JSON.stringify(payload);
  if (body.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "El mensaje es demasiado grande para el proxy." }, 413);
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    "user-agent": "WebhookRig/1.0",
  };

  if (isSellly && apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const authName = typeof input.authHeaderName === "string" ? input.authHeaderName.trim() : "";
  const authValue = typeof input.authHeaderValue === "string" ? input.authHeaderValue : "";
  if (authName && authValue) {
    if (!/^[A-Za-z0-9-]+$/.test(authName)) {
      return json({ ok: false, error: "El nombre del header de autenticación no es válido." }, 400);
    }
    headers[authName.toLowerCase()] = authValue;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(url.toString(), {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      redirect: "follow",
    });

    const response = truncate(await upstream.text(), MAX_UPSTREAM_CHARS);
    const contentType = upstream.headers.get("content-type") ?? "";
    const reply = upstream.ok && !isSellly
      ? extractReply(response.text, typeof input.responsePath === "string" ? input.responsePath : "")
      : null;

    return json(
      {
        ok: upstream.ok,
        status: upstream.status,
        statusText: upstream.statusText,
        elapsedMs: Math.round(performance.now() - started),
        finalUrl: upstream.url || url.toString(),
        contentType,
        reply,
        raw: response.text,
        truncated: response.truncated,
        headers: pickHeaders(upstream.headers),
        error: upstream.ok
          ? isSellly
            ? null
            : reply
              ? null
              : "El webhook respondió, pero no encontré texto de respuesta. Revisa la ruta de respuesta."
          : `El webhook respondió ${upstream.status} ${upstream.statusText}.`,
      },
      upstream.ok ? 200 : 502,
    );
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return json(
      {
        ok: false,
        error: aborted
          ? `El webhook no respondió en ${Math.round(timeoutMs / 1000)}s.`
          : `No se pudo contactar el webhook: ${error instanceof Error ? error.message : "error desconocido"}`,
        status: 0,
        elapsedMs: Math.round(performance.now() - started),
      },
      504,
    );
  } finally {
    clearTimeout(timer);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}\n\n… respuesta truncada (${text.length} caracteres)` , truncated: true };
}

function pickHeaders(headers: Headers): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of ["content-type", "server", "cf-ray", "date", "x-request-id", "x-ratelimit-remaining"]) {
    const value = headers.get(key);
    if (value) picked[key] = value;
  }
  return picked;
}
