/**
 * The briefing — what a session needs to know before it writes a line.
 *
 * Lives apart from any one door because three of them now read it: `varve brief`
 * in a terminal, the MCP server, and the skills that quote it. One composer means
 * an agent and a person cannot be told different things about the same project.
 *
 * The order is the one varve-load uses: urgency of not knowing, not recency.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { exists, listProjects } from "./store.js";
import { age, projectStandards, projectView, search, unfilled } from "./portal.js";

/**
 * Ceilings, in characters, at roughly four characters to the token.
 *
 * A brief that blows the context it was meant to save is worse than no brief,
 * and a caller cannot re-ask for less.
 */
const BRIEF_CHARS = 8_000; // ~2,000 tokens
const SEARCH_CHARS = 2_000; // ~500 tokens

/** Trim to a ceiling on a line boundary, and say so rather than ending mid-word. */
function cap(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const at = cut.lastIndexOf("\n");
  return `${cut.slice(0, at > 0 ? at : limit)}\n\n[truncated to fit the brief budget — use varve_search for the rest]`;
}

/** Strip frontmatter and HTML comments, then drop unfilled template lines. */
function curated(text: string): string {
  return unfilled(
    text
      .replace(/^(?:\s|<!--[\s\S]*?-->)*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim(),
  );
}

async function companyFiles(memory: string): Promise<string[]> {
  const out: string[] = [];
  for (const [name, heading] of [
    ["_company.md", "Company"],
    ["_standards.md", "Standards"],
  ] as const) {
    const file = join(memory, name);
    if (!(await exists(file))) continue;
    const body = curated(await readFile(file, "utf8"));
    // An unfilled template is not content. Saying nothing is honest; printing
    // twenty lines of square brackets reads as a filled-in file that says
    // nothing useful, which is worse than an absence the reader can act on.
    if (body) out.push(`## ${heading}\n\n${body}`);
  }
  return out;
}

/**
 * The briefing, in the order `varve-load` reads it: urgency of not knowing,
 * not recency.
 */
export async function brief(memory: string, project: string): Promise<string> {
  const view = await projectView(memory, project);
  if (!view) {
    const known = await listProjects(memory);
    return known.length
      ? `No project named "${project}" in this memory.\nprojects: ${known.join(", ")}`
      : `No project named "${project}", and this memory has no projects yet.\nnext: varve add <project> <repo-dir>`;
  }

  const head = [
    `memory: ${memory} · pulled ${await age(memory)}`,
    `project: ${view.project} · repos[${view.repos.length}]: ${view.repos.join(", ") || "none"} · logs: ${view.count}`,
  ];
  // A stale clone reads stale memory silently. That is this design's one quiet
  // failure, so the age goes at the top where it cannot be missed.

  const parts: string[] = [head.join("\n")];
  parts.push(...(await companyFiles(memory)));

  const standards = await projectStandards(memory, project);
  if (standards) {
    const body = curated(standards);
    if (body) parts.push(`## Standards — ${project}\n\n${body}\n\nWhere these disagree with company standards, these are the specific ones and win.`);
  }

  if (view.note) parts.push(`## ${view.project}\n\n${view.note}`);

  if (view.handoff) {
    const by = view.handoffBy;
    parts.push(`## Handoff\n\n${view.handoff}${by ? `\n\n— ${by.who}, ${by.date}` : ""}`);
  }

  // The newest ~15 logs, matching what the skill reads. Decided-against entries
  // are never struck through and never summarised away: they are live
  // constraints, and they are the class of knowledge nothing else keeps.
  const window = view.logs.slice(0, 15);
  const against = window.flatMap((l) => l.against.map((a) => `- ${a}  \n  — ${l.who}, ${l.date}`));
  if (against.length) parts.push(`## Decided against\n\n${against.join("\n")}`);

  const risks = window.flatMap((l) => l.risks.map((r) => `- ${r}  \n  — ${l.who}, ${l.date}`));
  if (risks.length) parts.push(`## Open risks\n\n${risks.join("\n")}`);

  const recent = view.logs.slice(0, 5).map((l) => {
    const line = (l.summary || l.summaryOnly).split(/\r?\n/).find((s) => s.trim()) ?? "";
    return `- ${l.date} · ${l.who} — ${line.replace(/^[-*]\s*/, "").trim()}`;
  });
  if (recent.length) parts.push(`## Recent sessions\n\n${recent.join("\n")}`);

  if (parts.length === 1) {
    parts.push(
      "This project has a roster but nothing written yet — no logs, and the curated note is still a template.",
    );
  }

  return cap(parts.join("\n\n"), BRIEF_CHARS);
}

export async function searchText(
  memory: string,
  query: string,
  opts: { project?: string; all?: boolean },
): Promise<string> {
  const hits = await search(memory, query, opts);
  if (!hits.length) {
    return `No match for "${query}"${opts.all ? "" : opts.project ? ` in ${opts.project}` : ""}.\nnext: retry with all=true to search every project`;
  }
  const rows = hits.map((h) => {
    // Company-wide files carry no date and no author — the fact is the company's,
    // not a session's. Rendering the log shape anyway produced rows that opened
    // " ·  · _company", which reads as missing data rather than as a different
    // kind of source. Name the file instead.
    const head = h.date && h.who ? `${h.date} · ${h.who} · ${h.project}` : h.rel;
    return `${head}${h.against ? " · DECIDED AGAINST" : ""}\n  ${h.line}`;
  });
  return cap(`${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}"\n\n${rows.join("\n")}`, SEARCH_CHARS);
}
