import type { APIRoute } from "astro";

export const prerender = false;

const TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ENTRIES = 500;
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

/**
 * Algunos emisores mandan saltos de linea sin escapar dentro de los strings.
 * Escapamos solo los caracteres de control que aparecen dentro de strings y
 * dejamos el resto intacto para volver a intentar el parseo.
 */
function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (!inString) {
      out += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      out += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      out += char;
      inString = false;
      continue;
    }

    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20) {
      if (char === "\n") out += "\\n";
      else if (char === "\r") out += "\\r";
      else if (char === "\t") out += "\\t";
      else out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }

    out += char;
  }

  return out;
}

function parseJsonBody(text: string): { payload: unknown; error: string | null } {
  try {
    return { payload: JSON.parse(text) as unknown, error: null };
  } catch {
    try {
      return { payload: JSON.parse(escapeControlCharsInStrings(text)) as unknown, error: null };
    } catch {
      return { payload: null, error: "El cuerpo del callback no es JSON válido." };
    }
  }
}

export const POST: APIRoute = async ({ params, request }) => {
  const executionId = executionIdFrom(params.executionId);
  if (!executionId) {
    return Response.json({ ok: false, error: "executionId inválido." }, { status: 400 });
  }

  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return Response.json(
      { ok: false, error: "El callback debe usar content-type application/json." },
      { status: 400 },
    );
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "El callback es demasiado grande." }, { status: 400 });
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return Response.json({ ok: false, error: "No se pudo leer el cuerpo." }, { status: 400 });
  }

  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "El callback es demasiado grande." }, { status: 400 });
  }

  const { payload, error: parseError } = parseJsonBody(text);
  if (parseError !== null) {
    return Response.json({ ok: false, error: parseError }, { status: 400 });
  }

  if (!hasMessages(payload)) {
    return Response.json(
      { ok: false, error: "Falta el arreglo messages en el callback." },
      { status: 400 },
    );
  }

  const now = Date.now();
  sweep(now);

  if (!store.has(executionId)) {
    while (store.size >= MAX_ENTRIES) {
      evictOldest();
    }
  }

  store.set(executionId, { receivedAt: now, payload });

  return Response.json({ ok: true }, { status: 200 });
};

export const GET: APIRoute = ({ params }) => {
  const executionId = executionIdFrom(params.executionId);
  if (!executionId) {
    return Response.json({ ok: false, error: "executionId inválido." }, { status: 400 });
  }

  const now = Date.now();
  sweep(now);

  const entry = store.get(executionId);
  if (!entry) {
    return Response.json({ ok: false, error: "Todavía no llegó el callback." }, { status: 404 });
  }

  return Response.json(
    { ok: true, receivedAt: entry.receivedAt, payload: entry.payload },
    { status: 200 },
  );
};

function hasMessages(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Array.isArray((payload as { messages?: unknown }).messages);
}
