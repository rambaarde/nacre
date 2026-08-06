/**
 * Announce a published log, and link the issue keys it mentions.
 *
 * Both halves are deliberately one-way and after the fact. A log reaches this
 * code only once a person has read it and said push, so announcing it is not
 * capture — it is the step that was missing, because today a log lands and
 * nobody learns it exists.
 *
 * What this is not: a sync. Nothing here writes into the memory, runs as a
 * service, or reads from a vendor. Pulling issues in would need a daemon and
 * would write with nobody present, which is the one thing the design does not
 * allow — and it would bury the reasoning trail under ticket churn, which is
 * the difference between this and a wiki.
 *
 * The webhook URL is a credential and never goes in the memory repo: it comes
 * from the environment, so it cannot be committed by accident. The issue
 * template is not a credential and lives in `_company.md`, where the team can
 * see and change it.
 */
import { join } from "node:path";

import { exists, frontmatter, readFile } from "./store.js";

/** `ENG-421`, `ATLAS-7`. Deliberately narrow: a bare number or a word with a
 *  hyphen is not an issue key, and a false link is worse than none. */
const ISSUE_KEY = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

/**
 * The issue URL template, e.g. `https://linear.app/acme/issue/{key}`.
 *
 * Read from `_company.md` because it is a company-wide fact about where issues
 * live — exactly the kind this file exists to hold — and because a per-repo
 * copy would drift.
 */
export async function issueTemplate(memory: string): Promise<string | null> {
  const file = join(memory, "_company.md");
  if (!(await exists(file))) return null;
  const value = frontmatter(await readFile(file, "utf8")).issues;
  const template = typeof value === "string" ? value.trim() : "";
  // A template without {key} would link every issue to the same page, which
  // looks like it works and is wrong everywhere.
  return template.includes("{key}") ? template : null;
}

export const issueUrl = (template: string, key: string): string =>
  template.replace(/\{key\}/g, encodeURIComponent(key));

/**
 * Turn issue keys into links inside already-escaped HTML.
 *
 * Runs last, over escaped output, so it can never introduce markup from the
 * source text. Keys already inside a tag — an href, a code span's attributes —
 * are skipped by only matching outside `<...>`.
 */
export function linkIssues(html: string, template: string | null): string {
  if (!template) return html;
  return html
    .split(/(<[^>]*>)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            ISSUE_KEY,
            (_m, key: string) =>
              `<a href="${issueUrl(template, key)}" rel="noreferrer">${key}</a>`,
          ),
    )
    .join("");
}

export interface LogLike {
  project: string;
  who: string;
  date: string;
  rel: string;
  summary: string;
  summaryOnly: string;
  against: string[];
}

/** Cut on a word boundary and say so, rather than stopping mid-word. */
const clip = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const at = text.lastIndexOf(" ", max);
  return `${text.slice(0, at > max / 2 ? at : max).replace(/[.,;:—-]$/, "")}…`;
};

/** One line a teammate can act on, plus what was ruled out. Short on purpose:
 *  a wall of text in a channel is scrolled past, which is the same as silence. */
export function announcement(log: LogLike, template: string | null): string {
  const first = (log.summary || log.summaryOnly)
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .find(Boolean) ?? "(no summary)";

  // Clipped hard. A channel message is scanned, not read: a paragraph gets
  // scrolled past, which is the same as never posting it.
  const lines = [`${log.who} logged ${log.project} — ${clip(first, 160)}`];
  if (log.against.length) {
    lines.push(
      `decided against: ${clip(log.against[0] as string, 160)}` +
        (log.against.length > 1 ? ` (+${log.against.length - 1} more)` : ""),
    );
  }
  const keys = [...new Set(`${first} ${log.against.join(" ")}`.match(ISSUE_KEY) ?? [])];
  if (keys.length && template) lines.push(keys.map((k) => issueUrl(template, k)).join(" · "));
  lines.push(log.rel);
  return lines.join("\n");
}

/**
 * Shape the body for whichever service the URL belongs to.
 *
 * Detected from the host rather than configured: one env var is already one
 * more than zero, and every service in this list is identifiable from its own
 * webhook URL.
 */
export function body(url: string, text: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  // Discord rejects a payload whose only field it does not recognise, so this
  // cannot simply send every key and hope.
  if (/(^|\.)discord(app)?\.com$/.test(host)) return JSON.stringify({ content: text });
  return JSON.stringify({ text });
}

export interface NotifyResult {
  sent: boolean;
  /** No webhook configured at all — a different thing from one that failed,
   *  and the only case where telling someone to set the variable helps. */
  unset?: boolean;
  /** Why nothing was sent, when nothing was. */
  reason?: string;
  status?: number;
}

/**
 * POST the announcement. Never throws.
 *
 * A failed announcement must not look like a failed publish: the log is already
 * pushed and safe by the time this runs, and a non-zero exit here would send
 * someone hunting for a problem in their memory that does not exist.
 */
export async function notify(
  text: string,
  { url = process.env.VARVE_NOTIFY_URL, timeoutMs = 5_000 }: { url?: string; timeoutMs?: number } = {},
): Promise<NotifyResult> {
  if (!url) return { sent: false, unset: true, reason: "VARVE_NOTIFY_URL is not set" };

  const stop = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(url, text),
      signal: stop,
    });
    return res.ok
      ? { sent: true, status: res.status }
      : { sent: false, status: res.status, reason: `webhook returned ${res.status}` };
  } catch (err) {
    return { sent: false, reason: (err as Error).message };
  }
}
