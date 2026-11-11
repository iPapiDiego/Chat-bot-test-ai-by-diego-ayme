import type { PayloadMode } from "./config";

export type Role = "user" | "assistant";

export interface ChatTurn {
  role: Role;
  content: string;
}

export interface ProbeRequest {
  url: string;
  transport: "proxy";
  payloadMode: PayloadMode;
  model: string;
  authHeaderName?: string;
  authHeaderValue?: string;
  responsePath?: string;
  timeoutMs?: number;
  sessionId?: string;
  message: string;
  history: ChatTurn[];
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  statusText: string;
  elapsedMs: number;
  finalUrl: string;
  contentType: string;
  reply: string | null;
  raw: string;
  truncated: boolean;
  headers: Record<string, string>;
  error: string | null;
}

export interface ProbeFailure {
  ok: false;
  error: string;
  status: number;
  elapsedMs: number;
}

export function buildPayload(
  mode: PayloadMode,
  input: { message: string; history: ChatTurn[]; model: string; sessionId: string },
): Record<string, unknown> {
  const turns: ChatTurn[] = [...input.history, { role: "user", content: input.message }];

  if (mode === "openai") {
    return {
      model: input.model || "demo",
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
      stream: false,
    };
  }

  return {
    sessionId: input.sessionId,
    message: input.message,
    history: input.history,
    timestamp: new Date().toISOString(),
  };
}

const REPLY_KEYS = [
  "reply",
  "response",
  "answer",
  "message",
  "output",
  "text",
  "content",
  "result",
  "data",
  "completion",
  "generated_text",
];

export function extractReply(raw: string, responsePath: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    if (LOOKS_LIKE_HTML.test(trimmed)) return null;
    return trimmed.slice(0, 8000);
  }

  if (typeof parsed === "string") return parsed.slice(0, 8000);

  const explicit = responsePath.trim() ? readPath(parsed, responsePath.trim()) : undefined;
  if (explicit !== undefined) {
    const text = coerceText(explicit);
    if (text) return text.slice(0, 8000);
  }

  const guessed = guessReply(parsed, 0);
  return guessed ? guessed.slice(0, 8000) : null;
}

const LOOKS_LIKE_HTML = /^<(!doctype|html|head|body|\?xml)/i;

function readPath(node: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  let current: unknown = node;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function guessReply(node: unknown, depth: number): string | null {
  if (depth > 4 || node === null || node === undefined) return null;
  if (typeof node === "string") return node.trim() ? node : null;

  if (Array.isArray(node)) {
    const parts = node.map((item) => guessReply(item, depth + 1)).filter(Boolean) as string[];
    return parts.length ? parts.join("\n") : null;
  }

  if (typeof node !== "object") return null;
  const record = node as Record<string, unknown>;

  const choices = record.choices;
  if (Array.isArray(choices) && choices.length) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    if (message) {
      const fromMessage = coerceText(message.content);
      if (fromMessage) return fromMessage;
    }
    const fromText = coerceText(first?.text);
    if (fromText) return fromText;
  }

  for (const key of REPLY_KEYS) {
    if (key in record) {
      const text = guessReply(record[key], depth + 1);
      if (text) return text;
    }
  }

  for (const value of Object.values(record)) {
    const text = guessReply(value, depth + 1);
    if (text) return text;
  }

  return null;
}

function coerceText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean);
    return parts.length ? parts.join("") : null;
  }
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    return typeof text === "string" && text.trim() ? text : null;
  }
  return null;
}

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,
  /^metadata\./i,
  /^\[?::ffff:/i,
];

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

export function validateTarget(rawUrl: string, allowPrivate: boolean): { url: URL | null; error: string | null } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { url: null, error: "La URL del webhook no es válida." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { url: null, error: "Solo se permiten URLs http o https." };
  }

  if (url.username || url.password) {
    return { url: null, error: "Quita las credenciales de la URL y usa los campos de autenticación." };
  }

  if (!allowPrivate && isPrivateHost(url.hostname)) {
    return {
      url: null,
      error: "El proxy bloquea direcciones privadas. Usa el transporte directo o prueba en local.",
    };
  }

  return { url, error: null };
}
