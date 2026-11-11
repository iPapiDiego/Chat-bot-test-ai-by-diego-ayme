import { env } from "cloudflare:workers";

const TTL_SECONDS = 10 * 60;
const KEY_PREFIX = "callback:";

export interface CallbackEntry {
  receivedAt: number;
  payload: unknown;
}

function key(executionId: string): string {
  return `${KEY_PREFIX}${executionId}`;
}

export async function saveCallback(executionId: string, entry: CallbackEntry): Promise<void> {
  await env.CALLBACKS.put(key(executionId), JSON.stringify(entry), {
    expirationTtl: TTL_SECONDS,
  });
}

export async function readCallback(executionId: string): Promise<CallbackEntry | null> {
  const raw = await env.CALLBACKS.get(key(executionId));
  if (!raw) return null;

  let parsed: Partial<CallbackEntry>;
  try {
    parsed = JSON.parse(raw) as Partial<CallbackEntry>;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || typeof parsed.receivedAt !== "number" || !("payload" in parsed)) {
    return null;
  }

  return { receivedAt: parsed.receivedAt, payload: parsed.payload };
}
