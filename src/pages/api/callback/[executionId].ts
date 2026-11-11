import type { APIRoute } from "astro";

export const prerender = false;

const TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ENTRIES = 200;
const EXECUTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CallbackEntry {
  receivedAt: number;
  payload: unknown;
}

declare global {
  var __selllyCallbackStore: Map<string, CallbackEntry> | undefined;
}

const store = (globalThis.__selllyCallbackStore ??= new Map<string, CallbackEntry>());

function sweep(now: number): void {
  for (const [key, entry] of store) {
    if (now - entry.receivedAt > TTL_MS) store.delete(key);
  }
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestTime = Number.POSITIVE_INFINITY;

  for (const [key, entry] of store) {
    if (entry.receivedAt < oldestTime) {
      oldestTime = entry.receivedAt;
      oldestKey = key;
    }
  }

  if (oldestKey !== null) store.delete(oldestKey);
}

function executionIdFrom(value: string | undefined): string | null {
  if (!value || !EXECUTION_ID.test(value)) return null;
  return value;
}

export const POST: APIRoute = async ({ params, request }) => {
  const executionId = executionIdFrom(params.executionId);
  if (!executionId) {
    return json({ ok: false, error: "executionId inválido." }, 400);
  }

  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return json({ ok: false, error: "El callback debe usar content-type application/json." }, 400);
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ ok: false, error: "El callback es demasiado grande." }, 400);
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return json({ ok: false, error: "No se pudo leer el cuerpo." }, 400);
  }

  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "El callback es demasiado grande." }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return json({ ok: false, error: "El cuerpo del callback no es JSON válido." }, 400);
  }

  if (!hasMessages(payload)) {
    return json({ ok: false, error: "Falta el arreglo messages en el callback." }, 400);
  }

  const now = Date.now();
  sweep(now);

  if (!store.has(executionId)) {
    while (store.size >= MAX_ENTRIES) {
      evictOldest();
    }
  }

  store.set(executionId, { receivedAt: now, payload });

  return json({ ok: true }, 200);
};

export const GET: APIRoute = ({ params }) => {
  const executionId = executionIdFrom(params.executionId);
  if (!executionId) {
    return json({ ok: false, error: "executionId inválido." }, 400);
  }

  const now = Date.now();
  sweep(now);

  const entry = store.get(executionId);
  if (!entry) {
    return json({ ok: false, error: "Todavía no llegó el callback." }, 404);
  }

  return json({ ok: true, receivedAt: entry.receivedAt, payload: entry.payload }, 200);
};

function hasMessages(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Array.isArray((payload as { messages?: unknown }).messages);
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
