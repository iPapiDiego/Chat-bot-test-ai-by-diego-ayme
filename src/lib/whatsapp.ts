const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function trimUrlEnd(url: string): string {
  let end = url.length;

  while (end > 0 && ".,;:!?'\"".includes(url[end - 1])) {
    end--;
  }

  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    if (url[end - 1] !== close) continue;
    const body = url.slice(0, end);
    if (body.split(close).length > body.split(open).length) end--;
  }

  return url.slice(0, end);
}

/**
 * Formatea texto estilo WhatsApp. Escapa el HTML primero y solo despues
 * inyecta las etiquetas propias, de modo que el texto del bot nunca puede
 * introducir HTML ejecutable.
 */
export function formatWhatsapp(input: string): string {
  const stashed: string[] = [];
  const stash = (html: string): string => {
    stashed.push(html);
    return `\u0001${stashed.length - 1}\u0001`;
  };

  let text = escapeHtml(input);

  text = text.replace(
    /```([\s\S]*?)```/g,
    (_match, code: string) =>
      stash(`<code class="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em]">${code}</code>`),
  );

  text = text.replace(/https?:\/\/[^\s<]+/g, (match) => {
    const url = trimUrlEnd(match);
    const trailing = match.slice(url.length);
    return (
      stash(
        `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline decoration-signal/50 text-signal hover:text-signal-soft">${url}</a>`,
      ) + trailing
    );
  });

  text = text.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*\*/g, () => stash("**"));
  text = text.replace(/\*([^*\n]+?)\*/g, "<strong>$1</strong>");
  text = text.replace(/_([^_\n]+?)_/g, "<em>$1</em>");
  text = text.replace(/~([^~\n]+?)~/g, "<s>$1</s>");

  text = text
    .split("\n")
    .map((line) => line.replace(/^(\s*)[-•]\s+/, "$1• "))
    .join("<br>");

  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(/\u0001(\d+)\u0001/g, (_match, index: string) => stashed[Number(index)] ?? "");
  }

  return text;
}
