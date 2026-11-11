export type Transport = "proxy" | "direct";
export type PayloadMode = "simple" | "openai" | "sellly";

export interface SavedTarget {
  id: string;
  label: string;
  url: string;
}

export interface RigConfig {
  webhookUrl: string;
  transport: Transport;
  payloadMode: PayloadMode;
  model: string;
  authHeaderName: string;
  authHeaderValue: string;
  responsePath: string;
  timeoutMs: number;
  sessionId: string;
  publicBase: string;
  apiKey: string;
  conversationId: string;
  contactId: string;
  contactExternalId: string;
  saved: SavedTarget[];
}

const STORAGE_KEY = "webhook-rig.config.v1";

export const DEFAULT_CONFIG: RigConfig = {
  webhookUrl: "",
  transport: "proxy",
  payloadMode: "simple",
  model: "demo",
  authHeaderName: "",
  authHeaderValue: "",
  responsePath: "",
  timeoutMs: 30000,
  sessionId: "",
  publicBase: "",
  apiKey: "",
  conversationId: "",
  contactId: "",
  contactExternalId: "",
  saved: [],
};

export function createSessionId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `sess_${Date.now().toString(36)}_${random}`;
}

export function createUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function orUuid(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : createUuid();
}

export function normalizeUrl(raw: string): string {
  return raw.trim().replace(/^["'<]+|["'>]+$/g, "");
}

export function parseWebhook(raw: string): { url: URL | null; error: string | null } {
  const value = normalizeUrl(raw);
  if (!value) {
    return { url: null, error: "Escribe la URL del webhook." };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { url: null, error: "La URL no es válida. Debe incluir https:// o http://." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { url: null, error: "Solo se permiten URLs http o https." };
  }

  if (!url.hostname) {
    return { url: null, error: "A la URL le falta el dominio." };
  }

  return { url, error: null };
}

export function hostLabel(raw: string): string {
  const { url } = parseWebhook(raw);
  return url ? url.host : "sin webhook";
}

export function targetLabel(raw: string): string {
  const { url } = parseWebhook(raw);
  if (!url) return "Webhook";
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.host}${path}`.slice(0, 46);
}

export function loadConfig(): RigConfig {
  const fallback: RigConfig = {
    ...DEFAULT_CONFIG,
    sessionId: createSessionId(),
    conversationId: createUuid(),
    contactId: createUuid(),
    contactExternalId: createUuid(),
  };
  if (typeof localStorage === "undefined") return fallback;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<RigConfig>;
    return {
      ...fallback,
      ...parsed,
      timeoutMs: clampTimeout(parsed.timeoutMs),
      transport: parsed.transport === "direct" ? "direct" : "proxy",
      payloadMode:
        parsed.payloadMode === "openai" ? "openai" : parsed.payloadMode === "sellly" ? "sellly" : "simple",
      saved: Array.isArray(parsed.saved) ? parsed.saved.filter(isSavedTarget) : [],
      sessionId: parsed.sessionId || fallback.sessionId,
      publicBase: typeof parsed.publicBase === "string" ? parsed.publicBase : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      conversationId: orUuid(parsed.conversationId),
      contactId: orUuid(parsed.contactId),
      contactExternalId: orUuid(parsed.contactExternalId),
    };
  } catch {
    return fallback;
  }
}

export function saveConfig(config: RigConfig): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function clampTimeout(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CONFIG.timeoutMs;
  return Math.min(120000, Math.max(2000, Math.round(numeric)));
}

function isSavedTarget(value: unknown): value is SavedTarget {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedTarget>;
  return typeof candidate.id === "string" && typeof candidate.url === "string" && typeof candidate.label === "string";
}
