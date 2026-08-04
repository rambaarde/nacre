/**
 * A small markdown renderer.
 *
 * Deliberately small rather than complete. The store is markdown that tooling
 * reads, not a format tooling owns — so anything this does not understand must
 * still come out readable as text rather than disappearing or throwing.
 *
 * Zero dependencies, and every value is escaped before it reaches the page.
 */

export const escape = (s: unknown): string =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Inline spans: code, bold, italic, links. Escaped first, so tags cannot inject. */
function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
}

/**
 * Block-level render. Handles headings, lists, fenced code, quotes, rules and
 * paragraphs — the shapes a session log actually uses. Anything else falls
 * through as a paragraph rather than being dropped.
 */
export function markdown(src: string = ""): string {
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: string | null = null;
  let fence: string[] | null = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const line of lines) {
    if (fence !== null) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${escape(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else fence.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); flushList(); fence = []; continue; }

    if (!line.trim()) { flushPara(); flushList(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara(); flushList();
      const level = Math.min((heading[1] as string).length + 1, 6);
      out.push(`<h${level}>${inline(heading[2] as string)}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); flushList(); out.push("<hr>"); continue; }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || number) {
      flushPara();
      const want = bullet ? "ul" : "ol";
      if (list !== want) { flushList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline(((bullet ?? number) as RegExpMatchArray)[1] as string)}</li>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushPara(); flushList(); out.push(`<blockquote>${inline(quote[1] as string)}</blockquote>`); continue; }

    para.push(line.trim());
  }

  if (fence !== null) out.push(`<pre><code>${escape(fence.join("\n"))}</code></pre>`);
  flushPara();
  flushList();
  return out.join("\n");
}
