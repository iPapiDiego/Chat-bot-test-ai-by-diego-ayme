import { initFlowbite } from "flowbite";
import {
  clampTimeout,
  createSessionId,
  createUuid,
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
  normalizeSelllyBlocks,
  type ChatTurn,
  type ProbeResult,
  type SelllyBlock,
  type SelllyCallback,
} from "../lib/webhook";

interface MessageTimings {
  ackMs: number;
  callbackMs: number | null;
  pollMs: number | null;
  totalMs: number;
  outcome: "ok" | "timeout" | "error";
  at: number;
}

type ChatMessage =
  | { id: string; kind: "user"; text: string; at: number; ms?: number }
  | {
      id: string;
      kind: "assistant";
      text: string;
      blocks?: SelllyBlock[];
      at: number;
      ms?: number;
      timings?: MessageTimings;
    }
  | { id: string; kind: "error"; text: string; at: number; timings?: MessageTimings };

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
const selllyWrap = el<HTMLDivElement>("sellly-wrap");
const publicBaseInput = el<HTMLInputElement>("field-public-base");
const apiKeyInput = el<HTMLInputElement>("field-api-key");
const selllyError = el<HTMLParagraphElement>("sellly-error");
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
const typingIndicator = el<HTMLDivElement>("typing-indicator");
const typingLabel = el<HTMLSpanElement>("typing-label");
const typingTimer = el<HTMLSpanElement>("typing-timer");
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
const callbackEmpty = el<HTMLDivElement>("callback-empty");
const callbackText = el<HTMLPreElement>("callback-text");
const replyTimings = el<HTMLDivElement>("reply-timings");
const replyTimingsList = el<HTMLDListElement>("reply-timings-list");
const statsCount = el<HTMLElement>("stats-count");
const statsLast = el<HTMLElement>("stats-last");
const statsAvg = el<HTMLElement>("stats-avg");
const statsMin = el<HTMLElement>("stats-min");
const statsMax = el<HTMLElement>("stats-max");
const statsP50 = el<HTMLElement>("stats-p50");
const statsP95 = el<HTMLElement>("stats-p95");
const statsList = el<HTMLOListElement>("stats-list");
const resetStatsButton = el<HTMLButtonElement>("reset-stats");
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
let pollGeneration = 0;
let sessionTimings: MessageTimings[] = [];
let tickTimer = 0;
let tickStart = 0;

function applyConfigToForm(): void {
  urlInput.value = config.webhookUrl;
  transportSelect.value = config.transport;
  payloadSelect.value = config.payloadMode;
  modelInput.value = config.model;
  authNameInput.value = config.authHeaderName;
  authValueInput.value = config.authHeaderValue;
  responsePathInput.value = config.responsePath;
  timeoutInput.value = String(Math.round(config.timeoutMs / 1000));
  publicBaseInput.value = config.publicBase;
  apiKeyInput.value = config.apiKey;
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
    payloadMode:
      payloadSelect.value === "openai"
        ? "openai"
        : payloadSelect.value === "sellly"
          ? "sellly"
          : "simple",
    model: modelInput.value.trim(),
    authHeaderName: authNameInput.value.trim(),
    authHeaderValue: authValueInput.value,
    responsePath: responsePathInput.value.trim(),
    timeoutMs: clampTimeout(Number(timeoutInput.value) * 1000),
    publicBase: publicBaseInput.value.trim().replace(/\/+$/, ""),
    apiKey: apiKeyInput.value.trim(),
  };
}

function syncConditionalFields(): void {
  const isOpenAi = payloadSelect.value === "openai";
  const isSellly = payloadSelect.value === "sellly";
  modelWrap.classList.toggle("hidden", !isOpenAi);
  selllyWrap.classList.toggle("hidden", !isSellly);
  if (!isSellly) {
    selllyError.classList.add("hidden");
  }
  transportHelp.textContent =
    transportSelect.value === "direct"
      ? "El modo directo llama a tu webhook desde el navegador. Tu endpoint debe permitir CORS, si no verás un error de red."
      : "El proxy hace la llamada desde el servidor de esta app: evita CORS y funciona con cualquier dominio.";
}

function validateSelllyFields(): boolean {
  const isSellly = payloadSelect.value === "sellly";
  selllyError.classList.add("hidden");
  if (!isSellly) return true;

  const base = publicBaseInput.value.trim();
  if (!base) {
    selllyError.textContent = "Escribe la URL pública del rig (por ejemplo el túnel de cloudflared).";
    selllyError.classList.remove("hidden");
    return false;
  }

  const { url } = parseWebhook(base);
  if (!url) {
    selllyError.textContent = "La URL pública del rig no es válida. Debe incluir https://.";
    selllyError.classList.remove("hidden");
    return false;
  }

  if (!apiKeyInput.value.trim()) {
    selllyError.textContent = "Escribe la apiKey de Sellly AI.";
    selllyError.classList.remove("hidden");
    return false;
  }

  return true;
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
    composerNote.textContent =
      config.payloadMode === "sellly"
        ? "Sellly AI responde por callback: el ACK llega al instante y el resultado se consulta por executionId."
        : `Los mensajes se envían a ${url.host} con formato ${config.payloadMode === "openai" ? "OpenAI" : "simple"}.`;
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

  transcript.append(typingIndicator);

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

  if (message.kind === "assistant" && message.blocks?.length) {
    bubble.classList.add("space-y-2");
    for (const block of message.blocks) {
      bubble.append(renderBlock(block));
    }
  } else {
    bubble.textContent = message.text;
  }

  wrapper.append(header, bubble);
  if (message.kind !== "user" && message.timings) {
    wrapper.append(renderTimingChip(message.timings));
  }
  return wrapper;
}

function renderBlock(block: SelllyBlock): HTMLElement {
  if (block.type === "image" || block.type === "video") {
    const figure = document.createElement("figure");
    figure.className = "space-y-1.5";

    if (block.type === "image") {
      const image = document.createElement("img");
      image.src = block.url ?? "";
      image.alt = block.caption ?? "Imagen enviada por el asistente";
      image.loading = "lazy";
      image.className = "max-h-72 w-auto max-w-full rounded-lg border border-white/10";
      figure.append(image);
    } else {
      const video = document.createElement("video");
      video.src = block.url ?? "";
      video.controls = true;
      video.preload = "metadata";
      video.className = "max-h-72 w-full rounded-lg border border-white/10";
      figure.append(video);
    }

    if (block.caption) {
      const caption = document.createElement("figcaption");
      caption.className = "text-[11.5px] text-quiet/70";
      caption.textContent = block.caption;
      figure.append(caption);
    }
    return figure;
  }

  const paragraph = document.createElement("p");
  paragraph.className = "whitespace-pre-wrap break-words";
  paragraph.textContent = block.text ?? "";
  return paragraph;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function scrollToBottom(): void {
  transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
}

const TIMER_NEUTRAL = "mt-1.5 font-mono text-[11.5px] tracking-tight text-quiet/70 tabular-nums";
const TIMER_DANGER = "mt-1.5 font-mono text-[11.5px] tracking-tight text-danger tabular-nums";
const TONE_CLASSES = ["text-paper", "text-signal", "text-warn", "text-danger"];

function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(2)} s`;
}

function formatClock(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}

function toneFor(totalMs: number, outcome: MessageTimings["outcome"]): string {
  if (outcome !== "ok") return "text-danger";
  if (totalMs > 15000) return "text-danger";
  if (totalMs >= 5000) return "text-warn";
  return "text-signal";
}

function paintTone(element: HTMLElement, tone: string): void {
  element.classList.remove(...TONE_CLASSES);
  element.classList.add(tone);
}

function renderTimingChip(timings: MessageTimings): HTMLElement {
  const chip = document.createElement("div");
  chip.className = "flex flex-wrap items-center gap-1.5 px-1 font-mono text-[10.5px] text-quiet/60";

  const parts = [`ACK ${formatSeconds(timings.ackMs)}`];
  if (timings.callbackMs !== null) {
    const poll = timings.pollMs !== null ? ` (+${formatSeconds(timings.pollMs)} polling)` : "";
    parts.push(`callback ${formatSeconds(timings.callbackMs)}${poll}`);
  } else if (timings.outcome === "timeout") {
    parts.push("callback no recibido");
  }

  for (const part of parts) {
    const item = document.createElement("span");
    item.textContent = part;
    chip.append(item);
    const separator = document.createElement("span");
    separator.textContent = "·";
    separator.className = "text-quiet/30";
    chip.append(separator);
  }

  const total = document.createElement("span");
  total.className = `font-medium ${toneFor(timings.totalMs, timings.outcome)}`;
  total.textContent = `${timings.outcome === "timeout" ? "timeout" : "total"} ${formatSeconds(timings.totalMs)}`;
  chip.append(total);

  return chip;
}

function renderReplyTimings(timings: MessageTimings | null): void {
  if (!timings) {
    replyTimings.classList.add("hidden");
    replyTimingsList.replaceChildren();
    return;
  }

  const callbackValue =
    timings.callbackMs === null
      ? timings.outcome === "timeout"
        ? "no recibido"
        : "—"
      : formatSeconds(timings.callbackMs);

  const rows: Array<[string, string, string | null]> = [
    ["ACK", formatSeconds(timings.ackMs), null],
    ["Callback", callbackValue, timings.outcome === "timeout" ? "text-danger" : null],
    ["Polling", timings.pollMs === null ? "—" : formatSeconds(timings.pollMs), null],
    ["Total", formatSeconds(timings.totalMs), toneFor(timings.totalMs, timings.outcome)],
  ];

  replyTimingsList.replaceChildren(
    ...rows.map(([label, value, tone]) => {
      const row = document.createElement("div");
      row.className = "flex items-baseline gap-3 border-b border-white/6 pb-1.5 last:border-0 last:pb-0";
      const term = document.createElement("dt");
      term.className = "w-20 shrink-0 text-[10.5px] tracking-wide text-quiet/55 uppercase";
      term.textContent = label;
      const desc = document.createElement("dd");
      desc.className = `min-w-0 flex-1 font-mono text-[11.5px] ${tone ?? "text-paper/85"}`;
      desc.textContent = value;
      row.append(term, desc);
      return row;
    }),
  );
  replyTimings.classList.remove("hidden");
}

function finalizeTimings(timings: MessageTimings): void {
  renderReplyTimings(timings);
  sessionTimings.push(timings);
  renderStats();
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function renderStats(): void {
  const totals = sessionTimings.map((timing) => timing.totalMs);
  statsCount.textContent = String(totals.length);

  if (!totals.length) {
    for (const element of [statsLast, statsAvg, statsMin, statsMax, statsP50, statsP95]) {
      element.textContent = "—";
      paintTone(element, "text-paper");
    }
    const empty = document.createElement("li");
    empty.className = "rounded-md border border-dashed border-white/10 px-3 py-2 text-[11px] text-quiet/55";
    empty.textContent = "Aún no hay mediciones.";
    statsList.replaceChildren(empty);
    return;
  }

  const sorted = [...totals].sort((a, b) => a - b);
  const last = sessionTimings[sessionTimings.length - 1];

  statsLast.textContent = formatSeconds(last.totalMs);
  paintTone(statsLast, toneFor(last.totalMs, last.outcome));
  statsAvg.textContent = formatSeconds(totals.reduce((sum, value) => sum + value, 0) / totals.length);
  statsMin.textContent = formatSeconds(sorted[0]);
  statsMax.textContent = formatSeconds(sorted[sorted.length - 1]);
  statsP50.textContent = formatSeconds(percentile(sorted, 50));
  statsP95.textContent = formatSeconds(percentile(sorted, 95));

  const recent = sessionTimings.slice(-20).reverse();
  statsList.replaceChildren(
    ...recent.map((timing, index) => {
      const item = document.createElement("li");
      item.className =
        "flex items-center gap-2 rounded-md border border-white/6 bg-white/[0.02] px-2 py-1 font-mono text-[10.5px]";

      const position = document.createElement("span");
      position.className = "w-7 shrink-0 text-quiet/40";
      position.textContent = `#${sessionTimings.length - index}`;

      const time = document.createElement("span");
      time.className = "text-quiet/55";
      time.textContent = formatTime(timing.at);

      const value = document.createElement("span");
      value.className = `ml-auto font-medium ${toneFor(timing.totalMs, timing.outcome)}`;
      value.textContent = formatSeconds(timing.totalMs);

      item.append(position, time, value);

      if (timing.outcome !== "ok") {
        const tag = document.createElement("span");
        tag.className = "rounded border border-danger/30 px-1 text-[9.5px] text-danger";
        tag.textContent = timing.outcome === "timeout" ? "timeout" : "error";
        item.append(tag);
      }

      return item;
    }),
  );
}

function resetStats(): void {
  sessionTimings = [];
  renderStats();
}

function showTyping(visible: boolean): void {
  typingIndicator.classList.toggle("hidden", !visible);
  typingIndicator.classList.toggle("flex", visible);
  if (visible) {
    transcript.append(typingIndicator);
    scrollToBottom();
  }
}

function startTicker(startedAt: number): void {
  stopTicker();
  tickStart = startedAt;
  typingLabel.textContent = "Esperando respuesta";
  typingLabel.className = "text-[13px] text-quiet/85";
  typingTimer.textContent = "00:00.0";
  typingTimer.className = TIMER_NEUTRAL;
  showTyping(true);
  tickTimer = window.setInterval(() => {
    typingTimer.textContent = formatClock(Date.now() - tickStart);
  }, 100);
}

function stopTicker(options?: { timeout?: boolean; totalMs?: number }): void {
  if (tickTimer) {
    window.clearInterval(tickTimer);
    tickTimer = 0;
  }

  if (options?.timeout) {
    const totalMs = options.totalMs ?? Date.now() - tickStart;
    typingLabel.textContent = "Timeout: callback no recibido";
    typingLabel.className = "text-[13px] text-danger/90";
    typingTimer.textContent = formatClock(totalMs);
    typingTimer.className = TIMER_DANGER;
    showTyping(true);
    return;
  }

  showTyping(false);
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

  const isSellly = config.payloadMode === "sellly";
  if (isSellly && !validateSelllyFields()) {
    publicBaseInput.focus();
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

  const executionId = isSellly ? createUuid() : "";
  const payload = buildPayload(config.payloadMode, {
    message: trimmed,
    history,
    model: config.model,
    sessionId: config.sessionId,
    executionId,
    publicBase: config.publicBase,
    apiKey: config.apiKey,
    conversationId: config.conversationId,
    contactId: config.contactId,
    contactExternalId: config.contactExternalId,
  });
  lastRequest = payload;
  requestText.textContent = JSON.stringify(payload, null, 2);
  renderReplyTimings(null);
  inspectStatus.textContent = "enviando";

  const startedAt = Date.now();
  startTicker(startedAt);
  setBusy(true);

  const started = performance.now();
  try {
    const result =
      config.transport === "direct"
        ? await sendDirect(url, payload, started)
        : await sendViaProxy(url, trimmed, history, executionId, started);

    const ackAt = Date.now();
    const elapsed = result.elapsedMs;
    latencyValue.textContent = `${elapsed} ms`;
    lastResult = result;
    updateInspector(result);

    if (isSellly) {
      await handleSelllyResult(result, executionId, startedAt, ackAt);
    } else {
      const totalMs = ackAt - startedAt;
      stopTicker();
      const timings: MessageTimings = {
        ackMs: totalMs,
        callbackMs: null,
        pollMs: null,
        totalMs,
        outcome: result.reply ? "ok" : "error",
        at: ackAt,
      };

      if (result.reply) {
        messages.push({
          id: `m_${Date.now().toString(36)}_a`,
          kind: "assistant",
          text: result.reply,
          at: Date.now(),
          ms: elapsed,
          timings,
        });
      } else {
        messages.push({
          id: `m_${Date.now().toString(36)}_e`,
          kind: "error",
          text: result.error ?? "La respuesta llegó sin texto legible. Revisa la pestaña Crudo.",
          at: Date.now(),
          timings,
        });
      }
      finalizeTimings(timings);
    }
    renderTranscript();
  } catch (error) {
    const failedAt = Date.now();
    const totalMs = failedAt - startedAt;
    stopTicker();
    const timings: MessageTimings = {
      ackMs: totalMs,
      callbackMs: null,
      pollMs: null,
      totalMs,
      outcome: "error",
      at: failedAt,
    };

    const message = error instanceof Error ? error.message : "Error desconocido";
    messages.push({
      id: `m_${Date.now().toString(36)}_e`,
      kind: "error",
      text: message,
      at: Date.now(),
      timings,
    });
    finalizeTimings(timings);
    latencyValue.textContent = "—";
    inspectStatus.textContent = "falló";
    renderTranscript();
  } finally {
    setBusy(false);
    renderConnection();
    messageInput.focus();
  }
}

async function handleSelllyResult(
  result: ProbeResult,
  executionId: string,
  startedAt: number,
  ackAt: number,
): Promise<void> {
  const ackMs = ackAt - startedAt;

  if (!result.ok) {
    const totalMs = Date.now() - startedAt;
    stopTicker();
    const timings: MessageTimings = {
      ackMs,
      callbackMs: null,
      pollMs: null,
      totalMs,
      outcome: "error",
      at: Date.now(),
    };
    messages.push({
      id: `m_${Date.now().toString(36)}_e`,
      kind: "error",
      text: result.error ?? `Sellly AI respondió ${result.status || "sin estado"} al ACK.`,
      at: Date.now(),
      timings,
    });
    finalizeTimings(timings);
    return;
  }

  typingLabel.textContent = "Esperando callback";
  setPolling(true);
  const generation = pollGeneration;
  const callback = await waitForCallback(executionId);
  setPolling(false);

  if (generation !== pollGeneration) {
    stopTicker();
    return;
  }

  if (!callback) {
    const totalMs = Date.now() - startedAt;
    stopTicker({ timeout: true, totalMs });
    const timings: MessageTimings = {
      ackMs,
      callbackMs: null,
      pollMs: null,
      totalMs,
      outcome: "timeout",
      at: Date.now(),
    };
    messages.push({
      id: `m_${Date.now().toString(36)}_e`,
      kind: "error",
      text: `Timeout a los ${formatClock(totalMs)}: el callback no llegó en 120 s. Revisa la URL pública del rig y el túnel.`,
      at: Date.now(),
      timings,
    });
    finalizeTimings(timings);
    return;
  }

  const observedAt = callback.observedAt;
  const totalMs = observedAt - startedAt;
  const callbackMs = Math.max(0, callback.receivedAt - ackAt);
  const pollMs = Math.max(0, observedAt - callback.receivedAt);
  const blocks = normalizeSelllyBlocks(callback.payload);
  const timings: MessageTimings = {
    ackMs,
    callbackMs,
    pollMs,
    totalMs,
    outcome: blocks.length ? "ok" : "error",
    at: observedAt,
  };

  stopTicker();
  updateCallbackInspector(callback);

  if (!blocks.length) {
    messages.push({
      id: `m_${Date.now().toString(36)}_e`,
      kind: "error",
      text: "El callback llegó sin bloques legibles. Revisa la pestaña Callback.",
      at: Date.now(),
      timings,
    });
  } else {
    messages.push({
      id: `m_${Date.now().toString(36)}_a`,
      kind: "assistant",
      text: blocks
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n\n"),
      blocks,
      at: Date.now(),
      ms: Math.round(totalMs),
      timings,
    });
  }
  finalizeTimings(timings);
}

function setPolling(active: boolean): void {
  if (active) {
    sendLabel.textContent = "Esperando";
    inspectStatus.textContent = "callback";
    composerNote.textContent = "ACK recibido. Esperando el callback de Sellly AI (hasta 120s)…";
  }
}

async function waitForCallback(executionId: string): Promise<SelllyCallback | null> {
  const generation = pollGeneration;
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline && generation === pollGeneration) {
    await delay(1000);
    if (generation !== pollGeneration) return null;

    try {
      const response = await fetch(`/api/callback/${encodeURIComponent(executionId)}`, {
        cache: "no-store",
      });
      if (response.status === 404) continue;
      if (!response.ok) continue;

      const data = (await response.json()) as {
        ok?: boolean;
        receivedAt?: number;
        payload?: unknown;
      };
      if (data && data.payload !== undefined) {
        return { receivedAt: data.receivedAt ?? Date.now(), observedAt: Date.now(), payload: data.payload };
      }
    } catch {
      // El callback aún no está disponible; seguimos consultando.
    }
  }

  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function updateCallbackInspector(callback: SelllyCallback): void {
  callbackEmpty.classList.add("hidden");
  callbackText.classList.remove("hidden");
  callbackText.textContent = JSON.stringify(callback.payload, null, 2);
  inspectStatus.textContent = "callback";
}

async function sendViaProxy(
  url: URL,
  message: string,
  history: ChatTurn[],
  executionId: string,
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
      apiKey: config.apiKey,
      publicBase: config.publicBase,
      executionId,
      conversationId: config.conversationId,
      contactId: config.contactId,
      contactExternalId: config.contactExternalId,
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
  const isSellly = config.payloadMode === "sellly";
  if (isSellly && config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await response.text();
    const reply = response.ok && !isSellly ? extractReply(raw, config.responsePath) : null;
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
        ? isSellly
          ? null
          : reply
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
    result.reply ??
    (config.payloadMode === "sellly" && result.ok
      ? "ACK recibido. La respuesta del asistente llegará por callback."
      : result.error ?? "La respuesta no contiene texto legible. Revisa la pestaña Crudo.");

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
    ...(config.payloadMode === "sellly"
      ? ([
          ["Conversación", config.conversationId],
          ["Contacto", config.contactId],
          ["Callback", `${config.publicBase}/api/callback/<executionId>`],
        ] as Array<[string, string]>)
      : []),
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
    if (payloadSelect.value === "sellly" && !validateSelllyFields()) {
      publicBaseInput.focus();
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
    pollGeneration++;
    stopTicker();
    resetStats();
    config = loadConfig();
    config.sessionId = createSessionId();
    config.conversationId = createUuid();
    config.contactId = createUuid();
    config.contactExternalId = createUuid();
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
    pollGeneration++;
    stopTicker();
    resetStats();
    messages = [];
    config = {
      ...config,
      sessionId: createSessionId(),
      conversationId: createUuid(),
      contactId: createUuid(),
      contactExternalId: createUuid(),
    };
    persistConfig();
    sessionLabel.textContent = `Sesión ${config.sessionId.slice(5, 13)}`;
    renderTranscript();
    resetInspector();
    messageInput.focus();
  });

  resetStatsButton.addEventListener("click", () => {
    resetStats();
    setFlash("Estadísticas reiniciadas");
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
  renderReplyTimings(null);
  rawEmpty.classList.remove("hidden");
  rawText.classList.add("hidden");
  rawText.textContent = "";
  callbackEmpty.classList.remove("hidden");
  callbackText.classList.add("hidden");
  callbackText.textContent = "";
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
  renderStats();
  try {
    initFlowbite();
  } catch {
    // Flowbite ya se inicializó en el evento load.
  }
}

boot();
