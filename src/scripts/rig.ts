import { initFlowbite } from "flowbite";
import {
  clampTimeout,
  createSessionId,
  hostLabel,
  loadConfig,
  parseWebhook,
  saveConfig,
  targetLabel,
  type RigConfig,
  type SavedTarget,
} from "../lib/config";
import {
  buildPayload,
  extractReply,
  type ChatTurn,
  type ProbeResult,
} from "../lib/webhook";

type ChatMessage =
  | { id: string; kind: "user" | "assistant"; text: string; at: number; ms?: number }
  | { id: string; kind: "error"; text: string; at: number };

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id}`);
  return node as T;
};

const form = el<HTMLFormElement>("rig-form");
const urlInput = el<HTMLInputElement>("field-url");
const transportSelect = el<HTMLSelectElement>("field-transport");
const payloadSelect = el<HTMLSelectElement>("field-payload");
const modelWrap = el<HTMLDivElement>("model-wrap");
const modelInput = el<HTMLInputElement>("field-model");
const authNameInput = el<HTMLInputElement>("field-auth-name");
const authValueInput = el<HTMLInputElement>("field-auth-value");
const toggleSecret = el<HTMLButtonElement>("toggle-secret");
const responsePathInput = el<HTMLInputElement>("field-response-path");
const timeoutInput = el<HTMLInputElement>("field-timeout");
const urlError = el<HTMLParagraphElement>("url-error");
const urlState = el<HTMLSpanElement>("url-state");
const transportHelp = el<HTMLParagraphElement>("transport-help");
const savedList = el<HTMLUListElement>("saved-list");
const savedCount = el<HTMLSpanElement>("saved-count");
const saveFlash = el<HTMLParagraphElement>("save-flash");
const saveTargetButton = el<HTMLButtonElement>("save-target");
const resetButton = el<HTMLButtonElement>("reset-rig");
const connectionDot = el<HTMLSpanElement>("connection-dot");
const connectionLabel = el<HTMLSpanElement>("connection-label");
const sessionLabel = el<HTMLParagraphElement>("session-label");
const latencyPill = el<HTMLSpanElement>("latency-pill");
const latencyValue = el<HTMLSpanElement>("latency-value");
const clearChatButton = el<HTMLButtonElement>("clear-chat");
const transcript = el<HTMLDivElement>("transcript");
const emptyState = el<HTMLDivElement>("empty-state");
const emptyHints = el<HTMLDivElement>("empty-hints");
const composer = el<HTMLFormElement>("composer");
const messageInput = el<HTMLTextAreaElement>("message-input");
const sendButton = el<HTMLButtonElement>("send-button");
const sendLabel = el<HTMLSpanElement>("send-label");
const charCount = el<HTMLSpanElement>("char-count");
const composerNote = el<HTMLParagraphElement>("composer-note");
const inspectStatus = el<HTMLSpanElement>("inspect-status");
const copyInspectButton = el<HTMLButtonElement>("copy-inspect");
const replyEmpty = el<HTMLDivElement>("reply-empty");
const replyContent = el<HTMLDivElement>("reply-content");
const replyMetaStatus = el<HTMLSpanElement>("reply-meta-status");
const replyMetaTime = el<HTMLSpanElement>("reply-meta-time");
const replyMetaType = el<HTMLSpanElement>("reply-meta-type");
const replyText = el<HTMLPreElement>("reply-text");
const rawEmpty = el<HTMLDivElement>("raw-empty");
const rawText = el<HTMLPreElement>("raw-text");
const requestText = el<HTMLPreElement>("request-text");
const metaList = el<HTMLDListElement>("meta-list");
const metaTarget = el<HTMLParagraphElement>("meta-target");
const openConfigButton = el<HTMLButtonElement>("open-config");
const closeConfigButton = el<HTMLButtonElement>("close-config");
const configPanel = el<HTMLElement>("config-panel");

let config: RigConfig = loadConfig();
let messages: ChatMessage[] = [];
let busy = false;
let lastResult: ProbeResult | null = null;
let lastRequest: Record<string, unknown> | null = null;
let flashTimer = 0;

function applyConfigToForm(): void {
  urlInput.value = config.webhookUrl;
  transportSelect.value = config.transport;
  payloadSelect.value = config.payloadMode;
  modelInput.value = config.model;
  authNameInput.value = config.authHeaderName;
  authValueInput.value = config.authHeaderValue;
  responsePathInput.value = config.responsePath;
  timeoutInput.value = String(Math.round(config.timeoutMs / 1000));
  syncConditionalFields();
  renderSaved();
  renderConnection();
  renderEmptyHints();
}

function readFormIntoConfig(): RigConfig {
  return {
    ...config,
    webhookUrl: urlInput.value.trim(),
    transport: transportSelect.value === "direct" ? "direct" : "proxy",
    payloadMode: payloadSelect.value === "openai" ? "openai" : "simple",
    model: modelInput.value.trim(),
    authHeaderName: authNameInput.value.trim(),
    authHeaderValue: authValueInput.value,
    responsePath: responsePathInput.value.trim(),
    timeoutMs: clampTimeout(Number(timeoutInput.value) * 1000),
  };
}

function syncConditionalFields(): void {
  const isOpenAi = payloadSelect.value === "openai";
  modelWrap.classList.toggle("hidden", !isOpenAi);
  transportHelp.textContent =
    transportSelect.value === "direct"
      ? "El modo directo llama a tu webhook desde el navegador. Tu endpoint debe permitir CORS, si no verás un error de red."
      : "El proxy hace la llamada desde el servidor de esta app: evita CORS y funciona con cualquier dominio.";
}

function validateUrlField(): boolean {
  const { url, error } = parseWebhook(urlInput.value);
  const hasValue = urlInput.value.trim().length > 0;

  if (!hasValue) {
    urlError.classList.add("hidden");
    urlState.textContent = "pendiente";
    urlState.className = "text-[11px] text-quiet/60";
    return false;
  }

  if (error) {
    urlError.textContent = error;
    urlError.classList.remove("hidden");
    urlState.textContent = "inválida";
    urlState.className = "text-[11px] text-danger";
    return false;
  }

  urlError.classList.add("hidden");
  urlState.textContent = url?.protocol === "https:" ? "https" : "http";
  urlState.className = "text-[11px] text-signal";
  return true;
}

function renderConnection(): void {
  const { url } = parseWebhook(config.webhookUrl);
  if (url) {
    connectionLabel.textContent = hostLabel(config.webhookUrl);
    connectionDot.className = "size-1.5 rounded-full bg-signal";
    composerNote.textContent = `Los mensajes se envían a ${url.host} con formato ${config.payloadMode === "openai" ? "OpenAI" : "simple"}.`;
  } else {
    connectionLabel.textContent = "Sin webhook configurado";
    connectionDot.className = "size-1.5 rounded-full bg-quiet/50";
    composerNote.textContent = "Sin webhook guardado, los mensajes no salen de tu navegador.";
  }
  metaTarget.textContent = config.webhookUrl || "Sin configurar";
}

function renderEmptyHints(): void {
  const hints = [
    { step: "1", text: "Pega la URL de tu webhook y pulsa Guardar ajustes." },
    { step: "2", text: "Escribe un mensaje de prueba y revisa la respuesta." },
    { step: "3", text: "Abre el inspector para ver el JSON crudo que devolvió." },
  ];

  emptyHints.replaceChildren(
    ...hints.map((hint) => {
      const row = document.createElement("div");
      row.className = "flex items-start gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5";
      const badge = document.createElement("span");
      badge.className =
        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-signal/30 font-mono text-[10px] text-signal";
      badge.textContent = hint.step;
      const text = document.createElement("p");
      text.className = "text-[12.5px] leading-relaxed text-quiet/85";
      text.textContent = hint.text;
      row.append(badge, text);
      return row;
    }),
  );
}

function renderSaved(): void {
  savedCount.textContent = String(config.saved.length);
  savedList.replaceChildren();
  savedList.className = config.saved.length ? "space-y-1.5" : "space-y-1.5";
  if (!config.saved.length) {
    const empty = document.createElement("li");
    empty.className = "rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-[11.5px] text-quiet/60";
    empty.textContent = "Guarda tus endpoints de demo para cambiar entre ellos sin copiar la URL.";
    savedList.append(empty);
    return;
  }

  for (const target of config.saved) {
    const item = document.createElement("li");
    item.className =
      "group flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2 py-1.5 transition hover:border-white/15";

    const load = document.createElement("button");
    load.type = "button";
    load.className = "min-w-0 flex-1 text-start";
    const title = document.createElement("span");
    title.className = "block truncate text-[12px] font-medium text-paper/90";
    title.textContent = target.label;
    const sub = document.createElement("span");
    sub.className = "block truncate font-mono text-[10.5px] text-quiet/55";
    sub.textContent = target.url;
    load.append(title, sub);
    load.addEventListener("click", () => {
      urlInput.value = target.url;
      config = { ...readFormIntoConfig() };
      persistConfig();
      setFlash(`Cargado ${target.label}`);
      syncTranscriptNotice();
      if (window.matchMedia("(max-width: 1023px)").matches) {
        messageInput.focus();
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className =
      "grid size-7 shrink-0 place-items-center rounded-md text-quiet/50 transition hover:bg-danger/10 hover:text-danger";
    remove.setAttribute("aria-label", `Eliminar ${target.label}`);
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" class="size-3.5" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>';
    remove.addEventListener("click", () => {
      config = { ...config, saved: config.saved.filter((entry) => entry.id !== target.id) };
      persistConfig();
      renderSaved();
      renderEmptyHints();
      setFlash("Destino eliminado");
    });

    item.append(load, remove);
    savedList.append(item);
  }
}

function persistConfig(): void {
  const persisted = saveConfig(config);
  renderConnection();
  if (!persisted) setFlash("No se pudo guardar en este navegador");
}

function setFlash(text: string): void {
  saveFlash.textContent = text;
  saveFlash.classList.remove("hidden");
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => saveFlash.classList.add("hidden"), 2600);
}

function syncTranscriptNotice(): void {
  const hasMessages = messages.length > 0;
  emptyState.classList.toggle("hidden", hasMessages);
  transcript.classList.toggle("justify-center", !hasMessages);
}

function renderTranscript(): void {
  transcript.querySelectorAll("[data-message]").forEach((node) => node.remove());

  for (const message of messages) {
    transcript.append(renderMessage(message));
  }

  syncTranscriptNotice();
  scrollToBottom();
}

function renderMessage(message: ChatMessage): HTMLElement {
  const wrapper = document.createElement("article");
  wrapper.dataset.message = message.id;
  wrapper.className =
    "animate-rise flex flex-col gap-1.5 " + (message.kind === "user" ? "items-end" : "items-start");

  const header = document.createElement("div");
  header.className = "flex items-center gap-2 px-1 text-[10.5px] text-quiet/50";
  const author = document.createElement("span");
  author.className = "font-medium tracking-wide uppercase";
  author.textContent =
    message.kind === "user" ? "Tú" : message.kind === "assistant" ? "Webhook" : "Error";
  const time = document.createElement("span");
  time.className = "font-mono";
  time.textContent = formatTime(message.at);
  header.append(author, time);

  if (message.kind !== "error" && typeof message.ms === "number") {
    const ms = document.createElement("span");
    ms.className = "font-mono text-signal/70";
    ms.textContent = `${message.ms} ms`;
    header.append(ms);
  }

  const bubble = document.createElement("div");
  bubble.className =
    message.kind === "user"
      ? "max-w-[85%] rounded-2xl rounded-ee-md border border-signal/25 bg-signal/12 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap break-words text-paper"
      : message.kind === "assistant"
        ? "max-w-[92%] rounded-2xl rounded-es-md border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap break-words text-paper/95"
        : "max-w-[92%] rounded-2xl rounded-es-md border border-danger/25 bg-danger/8 px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-danger/95";
  bubble.textContent = message.text;

  wrapper.append(header, bubble);
  return wrapper;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function scrollToBottom(): void {
  transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
}

function setBusy(value: boolean): void {
  busy = value;
  sendButton.disabled = value;
  sendLabel.textContent = value ? "Enviando" : "Enviar";
  inspectStatus.textContent = value ? "esperando" : lastResult ? String(lastResult.status || "error") : "idle";
  if (value) {
    latencyPill.classList.remove("hidden");
    latencyValue.textContent = "…";
  }
}

async function sendMessage(text: string): Promise<void> {
  if (busy) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  const { url, error } = parseWebhook(config.webhookUrl);
  if (!url) {
    urlInput.focus();
    urlError.textContent = error ?? "Configura un webhook antes de enviar.";
    urlError.classList.remove("hidden");
    return;
  }

  const history: ChatTurn[] = messages
    .filter((message): message is Extract<ChatMessage, { kind: "user" | "assistant" }> =>
      message.kind === "user" || message.kind === "assistant",
    )
    .map((message) => ({ role: message.kind === "user" ? "user" : "assistant", content: message.text }));

  const userMessage: ChatMessage = {
    id: `m_${Date.now().toString(36)}_u`,
    kind: "user",
    text: trimmed,
    at: Date.now(),
  };
  messages.push(userMessage);
  renderTranscript();
  messageInput.value = "";
  autoSize();
  updateCharCount();

  const payload = buildPayload(config.payloadMode, {
    message: trimmed,
    history,
    model: config.model,
    sessionId: config.sessionId,
  });
  lastRequest = payload;
  requestText.textContent = JSON.stringify(payload, null, 2);
  inspectStatus.textContent = "enviando";
  setBusy(true);

  const started = performance.now();
  try {
    const result =
      config.transport === "direct"
        ? await sendDirect(url, payload, started)
        : await sendViaProxy(url, trimmed, history, started);

    const elapsed = result.elapsedMs;
    latencyValue.textContent = `${elapsed} ms`;
    lastResult = result;
    updateInspector(result);

    if (result.reply) {
      messages.push({
        id: `m_${Date.now().toString(36)}_a`,
        kind: "assistant",
        text: result.reply,
        at: Date.now(),
        ms: elapsed,
      });
    } else {
      messages.push({
        id: `m_${Date.now().toString(36)}_e`,
        kind: "error",
        text: result.error ?? "La respuesta llegó sin texto legible. Revisa la pestaña Crudo.",
        at: Date.now(),
      });
    }
    renderTranscript();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    messages.push({
      id: `m_${Date.now().toString(36)}_e`,
      kind: "error",
      text: message,
      at: Date.now(),
    });
    latencyValue.textContent = "—";
    inspectStatus.textContent = "falló";
    renderTranscript();
  } finally {
    setBusy(false);
    messageInput.focus();
  }
}

async function sendViaProxy(
  url: URL,
  message: string,
  history: ChatTurn[],
  started: number,
): Promise<ProbeResult> {
  const response = await fetch("/api/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: url.toString(),
      payloadMode: config.payloadMode,
      model: config.model,
      authHeaderName: config.authHeaderName,
      authHeaderValue: config.authHeaderValue,
      responsePath: config.responsePath,
      timeoutMs: config.timeoutMs,
      sessionId: config.sessionId,
      message,
      history,
    }),
  });

  const data = (await response.json()) as Partial<ProbeResult> & { error?: string | null };
  if (typeof data.ok !== "boolean") {
    return {
      ok: false,
      status: response.status,
      statusText: "Proxy error",
      elapsedMs: Math.round(performance.now() - started),
      finalUrl: url.toString(),
      contentType: "",
      reply: null,
      raw: "",
      truncated: false,
      headers: {},
      error: data.error || "El servidor rechazó la petición.",
    };
  }

  return {
    ok: data.ok,
    status: data.status ?? 0,
    statusText: data.statusText ?? "",
    elapsedMs: data.elapsedMs ?? Math.round(performance.now() - started),
    finalUrl: data.finalUrl ?? url.toString(),
    contentType: data.contentType ?? "",
    reply: data.reply ?? null,
    raw: data.raw ?? "",
    truncated: data.truncated ?? false,
    headers: data.headers ?? {},
    error: data.error ?? null,
  };
}

async function sendDirect(
  url: URL,
  payload: Record<string, unknown>,
  started: number,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), config.timeoutMs);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/plain;q=0.9, */*;q=0.8",
  };
  if (config.authHeaderName && config.authHeaderValue) {
    headers[config.authHeaderName] = config.authHeaderValue;
  }

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await response.text();
    const reply = response.ok ? extractReply(raw, config.responsePath) : null;
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      elapsedMs: Math.round(performance.now() - started),
      finalUrl: response.url || url.toString(),
      contentType: response.headers.get("content-type") ?? "",
      reply,
      raw,
      truncated: false,
      headers: Object.fromEntries(
        ["content-type", "server", "date", "x-request-id"].flatMap((key) => {
          const value = response.headers.get(key);
          return value ? [[key, value]] : [];
        }),
      ),
      error: response.ok
        ? reply
          ? null
          : "La respuesta llegó sin texto legible. Revisa la pestaña Crudo."
        : `El webhook respondió ${response.status} ${response.statusText}.`,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`El webhook no respondió en ${Math.round(config.timeoutMs / 1000)}s.`);
    }
    throw new Error(
      "El navegador bloqueó la llamada directa. Suele ser CORS: habilita Access-Control-Allow-Origin en tu webhook o usa el transporte por proxy.",
    );
  } finally {
    window.clearTimeout(timer);
  }
}

function updateInspector(result: ProbeResult): void {
  replyEmpty.classList.add("hidden");
  replyContent.classList.remove("hidden");
  replyMetaStatus.textContent = `${result.status || "—"} ${result.statusText}`.trim();
  replyMetaStatus.className = `rounded border px-1.5 py-0.5 font-mono ${
    result.ok ? "border-signal/30 text-signal" : "border-danger/30 text-danger"
  }`;
  replyMetaTime.textContent = `${result.elapsedMs} ms`;
  replyMetaType.textContent = result.contentType || "sin content-type";
  replyText.textContent =
    result.reply ?? result.error ?? "La respuesta no contiene texto legible. Revisa la pestaña Crudo.";

  rawEmpty.classList.add("hidden");
  rawText.classList.remove("hidden");
  rawText.textContent = result.raw || "(respuesta vacía)";

  const rows: Array<[string, string]> = [
    ["Estado", `${result.status || "—"} ${result.statusText}`.trim()],
    ["Tiempo", `${result.elapsedMs} ms`],
    ["Tipo", result.contentType || "—"],
    ["Transporte", config.transport === "direct" ? "directo" : "proxy"],
    ["Formato", config.payloadMode],
    ["Truncado", result.truncated ? "sí" : "no"],
    ["URL final", result.finalUrl],
    ["Sesión", config.sessionId],
    ...Object.entries(result.headers).map(([key, value]) => [key, value] as [string, string]),
  ];

  metaList.replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement("div");
      row.className = "flex items-start gap-3 border-b border-white/6 pb-2 last:border-0";
      const term = document.createElement("dt");
      term.className = "w-24 shrink-0 text-[11px] tracking-wide text-quiet/55 uppercase";
      term.textContent = label;
      const desc = document.createElement("dd");
      desc.className = "min-w-0 flex-1 font-mono text-[11.5px] break-all text-paper/85";
      desc.textContent = value;
      row.append(term, desc);
      return row;
    }),
  );
}

function autoSize(): void {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 160)}px`;
}

function updateCharCount(): void {
  const length = messageInput.value.length;
  charCount.textContent = String(length);
  charCount.classList.toggle("hidden", length === 0);
  charCount.classList.toggle("text-danger", length > 2000);
}

function setConfigOpen(open: boolean): void {
  const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
  if (isDesktop) {
    configPanel.classList.remove("hidden");
    configPanel.classList.add("block");
    openConfigButton.setAttribute("aria-expanded", "false");
    return;
  }
  configPanel.classList.toggle("hidden", !open);
  openConfigButton.setAttribute("aria-expanded", String(open));
  if (open) {
    urlInput.focus({ preventScroll: true });
  } else {
    openConfigButton.focus({ preventScroll: true });
  }
}

function showMobileView(view: "chat" | "inspect"): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view-btn]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewBtn === view));
  });
  document.querySelectorAll<HTMLElement>("[data-view-panel]").forEach((panel) => {
    const isActive = panel.dataset.viewPanel === view;
    panel.classList.toggle("hidden", !isActive);
    panel.classList.toggle("flex", isActive);
  });
}

function buildSavedTarget(url: URL): SavedTarget {
  return {
    id: `t_${Date.now().toString(36)}`,
    label: targetLabel(url.toString()),
    url: url.toString(),
  };
}

function initEvents(): void {
  [urlInput, payloadSelect, transportSelect].forEach((input) => {
    input.addEventListener("input", () => {
      validateUrlField();
      syncConditionalFields();
    });
    input.addEventListener("change", () => {
      validateUrlField();
      syncConditionalFields();
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validateUrlField()) {
      if (!urlInput.value.trim()) {
        urlError.textContent = "Escribe la URL del webhook antes de guardar.";
        urlError.classList.remove("hidden");
      }
      urlInput.focus();
      return;
    }
    config = readFormIntoConfig();
    config.sessionId = config.sessionId || createSessionId();
    persistConfig();
    setFlash("Ajustes guardados en este navegador");
    renderEmptyHints();
    renderSaved();
  });

  toggleSecret.addEventListener("click", () => {
    const showing = authValueInput.type === "text";
    authValueInput.type = showing ? "password" : "text";
    toggleSecret.setAttribute("aria-pressed", String(!showing));
  });

  saveTargetButton.addEventListener("click", () => {
    const { url, error } = parseWebhook(urlInput.value);
    if (!url) {
      urlError.textContent = error ?? "La URL no es válida.";
      urlError.classList.remove("hidden");
      urlInput.focus();
      return;
    }
    if (config.saved.some((target) => target.url === url.toString())) {
      setFlash("Ese webhook ya está guardado");
      return;
    }
    config = {
      ...readFormIntoConfig(),
      saved: [buildSavedTarget(url), ...config.saved].slice(0, 12),
    };
    urlInput.value = url.toString();
    persistConfig();
    renderSaved();
    setFlash("Webhook guardado");
  });

  resetButton.addEventListener("click", () => {
    if (!window.confirm("¿Restablecer todos los ajustes y borrar la conversación?")) return;
    localStorage.removeItem("webhook-rig.config.v1");
    config = loadConfig();
    config.sessionId = createSessionId();
    messages = [];
    lastResult = null;
    lastRequest = null;
    applyConfigToForm();
    renderTranscript();
    resetInspector();
    persistConfig();
    setFlash("Ajustes restablecidos");
    sessionLabel.textContent = `Sesión ${config.sessionId.slice(5, 13)}`;
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage(messageInput.value);
  });

  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage(messageInput.value);
    }
  });

  messageInput.addEventListener("input", () => {
    autoSize();
    updateCharCount();
  });

  clearChatButton.addEventListener("click", () => {
    if (!messages.length) return;
    messages = [];
    renderTranscript();
    messageInput.focus();
  });

  copyInspectButton.addEventListener("click", async () => {
    const payload = lastResult?.raw || JSON.stringify(lastRequest ?? {}, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      copyInspectButton.setAttribute("aria-label", "Copiado");
      setFlash("Copiado al portapapeles");
    } catch {
      setFlash("No se pudo copiar");
    }
  });

  openConfigButton.addEventListener("click", () => {
    setConfigOpen(configPanel.classList.contains("hidden"));
  });

  closeConfigButton.addEventListener("click", () => setConfigOpen(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !configPanel.classList.contains("hidden")) {
      const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
      if (!isDesktop) setConfigOpen(false);
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-view-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      showMobileView(button.dataset.viewBtn === "inspect" ? "inspect" : "chat");
    });
  });

  const media = window.matchMedia("(min-width: 1280px)");
  const syncDesktop = () => {
    if (media.matches) {
      document.querySelectorAll<HTMLElement>("[data-view-panel]").forEach((panel) => {
        panel.classList.remove("hidden");
        panel.classList.add("flex");
      });
    } else {
      const active = document.querySelector<HTMLButtonElement>('[data-view-btn][aria-pressed="true"]');
      showMobileView(active?.dataset.viewBtn === "inspect" ? "inspect" : "chat");
    }
  };
  media.addEventListener("change", syncDesktop);
}

function resetInspector(): void {
  replyEmpty.classList.remove("hidden");
  replyContent.classList.add("hidden");
  rawEmpty.classList.remove("hidden");
  rawText.classList.add("hidden");
  rawText.textContent = "";
  requestText.textContent = "{}";
  metaList.replaceChildren();
  inspectStatus.textContent = "idle";
  latencyPill.classList.add("hidden");
}

function boot(): void {
  applyConfigToForm();
  sessionLabel.textContent = config.sessionId ? `Sesión ${config.sessionId.slice(5, 13)}` : "Sesión nueva";
  validateUrlField();
  initEvents();
  requestText.textContent = "{}";
  if (config.webhookUrl) {
    emptyState.classList.remove("hidden");
  }
  autoSize();
  updateCharCount();
  try {
    initFlowbite();
  } catch {
    // Flowbite ya se inicializó en el evento load.
  }
}

boot();
