export type Transport = "proxy" | "direct";
export type PayloadMode = "simple" | "openai";

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
  saved: [],
};

export function createSessionId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `sess_${Date.now().toString(36)}_${random}`;
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
  const fallback: RigConfig = { ...DEFAULT_CONFIG, sessionId: createSessionId() };
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
      payloadMode: parsed.payloadMode === "openai" ? "openai" : "simple",
      saved: Array.isArray(parsed.saved) ? parsed.saved.filter(isSavedTarget) : [],
      sessionId: parsed.sessionId || fallback.sessionId,
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
