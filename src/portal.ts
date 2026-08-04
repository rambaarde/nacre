/**
 * Reading the memory: logs, views, and one search.
 *
 * These are operations, not rendering. The CLI and the local portal both call
 * them, which is the point — if search lived in two places the two doors would
 * eventually rank the same query differently, and the promise of one mental
 * model across both would quietly stop being true.
 *
 * Zero inference. Everything here is a file read.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { exists, frontmatter, readRoster, listProjects } from "./store.js";
import type { Frontmatter } from "./store.js";

export interface LogSections {
  fm: Frontmatter;
  body: string;
  summary: string;
  against: string[];
  decisions: string[];
  risks: string[];
  notes: string[];
  /** The hook-written block: repo, branch, commits. Machine output, kept out
   *  of the summary so it never stands in for what a person wrote. */
  auto: string[];
  next: string;
}

export interface Log extends LogSections {
  /** The body with the auto block removed, so the page renders notes then git. */
  summaryOnly: string;
  project: string; team: string; who: string;
  file: string; id: string; path: string; rel: string;
  date: string; stamp: string; repos: string[]; supersedes: string | null;
}

export interface Hit {
  date: string; who: string; project: string; repo: string;
  line: string; id: string; rel: string; against: boolean;
}

/**
 * The labels a session log may carry.
 *
 * Two shapes are recognised, because the format this design descends from uses
 * neither exclusively: a `## Heading`, and a `* **Bold label:**` bullet under a
 * single heading. The bullet form is what a 103-day-old vault actually contains,
 * and a parser that only understood headings surfaced nothing from it — the
 * store rendered, but every block on the project page came up empty.
 */
const SECTION: Record<string, RegExp> = {
  summary: /^(high[- ]level\s+)?summary\b|^what\s+changed\b/i,
  decision: /^(important\s+)?decisions?\b/i,
  against: /^(decided\s+against|rejected|not\s+doing)\b/i,
  risk: /^((open\s+)?risks?|constraints?(\s*\/\s*blockers?)?|blockers?)\b/i,
  next: /^next(\s+steps?)?\b/i,
  note: /^notes?(\s+for\s+future\s+ai)?\b/i,
  auto: /^auto\s+session\s+log\b/i,
};

/** `## Decided against` → "decided against" */
const asHeading = (line: string): string | null => {
  const m = line.match(/^#{1,6}\s+(.*?)\s*$/);
  return m ? (m[1] as string) : null;
};

/** `* **Important Decisions:** text` → { label, rest } */
const asBullet = (line: string): { label: string; rest: string } | null => {
  const m = line.match(/^\s*[-*+]\s*\*\*(.+?):?\*\*:?\s*(.*)$/);
  return m ? { label: m[1] as string, rest: (m[2] as string).trim() } : null;
};

const labelKey = (label: string): string | null =>
  Object.keys(SECTION).find((k) => (SECTION[k] as RegExp).test(label.trim())) ?? null;

/**
 * Split a log into frontmatter, its titled sections, and the rest.
 *
 * A log that does not use these headings still parses — it simply has no
 * sections, and its body renders whole. Failing to understand a file must never
 * mean losing it.
 */
export function parseLog(text: string): LogSections {
  const fm = frontmatter(text);
  const body = text.replace(/^(?:\s|<!--[\s\S]*?-->)*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const sections: Record<string, string[]> = {
    summary: [], against: [], decision: [], risk: [], next: [], note: [], auto: [],
  };
  let current: string | null = null;
  const rest: string[] = [];

  for (const line of body.split(/\r?\n/)) {
    // The auto block is appended last and is terminal: its own bullets carry
    // labels the human sections do not use, and letting them fall through would
    // leak machine output back into the prose.
    if (current === "auto") {
      if (line.trim()) (sections.auto as string[]).push(line.trim());
      continue;
    }

    // A labelled bullet closes any open section and stands alone, so a list of
    // them under one heading parses the same as a run of headings.
    const bullet = asBullet(line);
    if (bullet) {
      const key = labelKey(bullet.label);
      if (key) {
        if (bullet.rest) (sections[key] as string[]).push(bullet.rest);
        current = key;
        continue;
      }
      current = null;
      rest.push(line);
      continue;
    }

    const heading = asHeading(line);
    if (heading !== null) {
      current = labelKey(heading);
      if (current) continue;
    }

    if (current) {
      const bucket = sections[current] as string[];
      if (line.trim()) bucket.push(line.trim());
      else if (bucket.length) bucket.push("");
    } else rest.push(line);
  }

  // A wrapped bullet is one thought across several lines, not several entries.
  // Blank lines still separate entries; single newlines are just the author's
  // line width and get folded away.
  const clean = (arr: string[]): string[] =>
    arr
      .join("\n")
      .split(/\n{2,}/)
      .map((block) => block.split(/\n/).map((l) => l.trim()).filter(Boolean).join(" ").trim())
      .filter(Boolean);


  const titled = clean(sections.summary as string[]).join(" ");
  return {
    fm,
    body: body.trim(),
    // A labelled summary wins; otherwise whatever prose was not under a label.
    summary: titled || rest.join("\n").trim(),
    against: clean(sections.against as string[]),
    decisions: clean(sections.decision as string[]),
    risks: clean(sections.risk as string[]),
    notes: clean(sections.note as string[]),
    auto: clean(sections.auto as string[]),
    next: clean(sections.next as string[]).join(" "),
  };
}

/** Every session log, newest first. `project` narrows; omitting it is company-wide. */
export async function readLogs(memory: string, project?: string): Promise<Log[]> {
  const projects = project ? [project] : await listProjects(memory);
  const logs: Log[] = [];

  for (const p of projects) {
    const root = join(memory, p);
    if (!(await exists(root))) continue;
    for (const team of await readdir(root, { withFileTypes: true })) {
      if (!team.isDirectory() || team.name.startsWith("_")) continue;
      for (const person of await readdir(join(root, team.name), { withFileTypes: true })) {
        if (!person.isDirectory()) continue;
        const dir = join(root, team.name, person.name);
        for (const name of await readdir(dir)) {
          if (!name.endsWith(".md")) continue;
          const path = join(dir, name);
          const text = await readFile(path, "utf8");
          const parsed = parseLog(text);
          logs.push({
            project: p, team: team.name, who: person.name,
            file: name, id: name.replace(/\.md$/, ""), path,
            rel: relative(memory, path),
            date: name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "",
            // Sort on the timestamp alone. The filename starts with the project
            // slug, so sorting by name would order company-wide reads
            // alphabetically by project and only look right inside one.
            stamp: name.match(/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/)?.[1] ?? name,
            summaryOnly: parsed.body.split(/^#{1,6}\s*auto\s+session\s+log\b/im)[0]!.trim(),
            repos: Array.isArray(parsed.fm.repos) ? parsed.fm.repos : [],
            supersedes: (parsed.fm.supersedes as string) ?? null,
            ...parsed,
          });
        }
      }
    }
  }
  return logs.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
}

/**
 * One search, used by every door.
 *
 * Ranking lives here; truncation is the caller's job. The CLI cuts to its token
 * ceiling, the portal shows everything, and because both rank identically the
 * two can differ in length without ever disagreeing about what matters.
 */
export async function search(
  memory: string,
  query: string,
  { project, all }: { project?: string; all?: boolean } = {},
): Promise<Hit[]> {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [];
  const logs = await readLogs(memory, all ? undefined : project);
  const hits: Hit[] = [];

  for (const log of logs) {
    for (const raw of log.body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || !line.toLowerCase().includes(q)) continue;
      hits.push({
        date: log.date, who: log.who, project: log.project,
        // Empty when the log names no repo, rather than quietly substituting the
        // project — a column headed "repo" holding a project name is a field
        // that lies, and a caller cannot tell which it got.
        repo: log.repos[0] ?? "", line: line.replace(/^#{1,6}\s*/, ""),
        id: log.id, rel: log.rel,
        against: log.against.some((a) => a.toLowerCase().includes(q)),
      });
    }
  }

  // Company-level files carry facts owned by more than one project — the rows a
  // per-repo tool can never produce. They rank alongside logs, not below them.
  for (const name of ["_company.md", "_standards.md"]) {
    const path = join(memory, name);
    if (!(await exists(path))) continue;
    const text = await readFile(path, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || !line.toLowerCase().includes(q)) continue;
      hits.push({
        date: "", who: "", project: "_company", repo: name.replace(/\.md$/, ""),
        line: line.replace(/^[#>*\-\s]+/, ""), id: name, rel: name, against: false,
      });
    }
  }

  return hits.sort((a, b) => {
    if (a.against !== b.against) return a.against ? -1 : 1; // live constraints first
    return a.date < b.date ? 1 : -1;
  });
}

/** Does this project carry its own standards? */
export async function projectStandards(memory: string, project: string): Promise<string | null> {
  const file = join(memory, project, "_standards.md");
  if (!(await exists(file))) return null;
  return readFile(file, "utf8");
}

/** Everything the project page needs, in the order it is read. */
/**
 * Drop the lines of a curated note nobody filled in.
 *
 * The project template ships as prompts — `* **Purpose:** [What problem this
 * product solves]`. Rendered verbatim that is thirty lines of square brackets
 * sitting above the logs, which reads as content, answers nothing, and pushes
 * the actual session history below the fold. A half-written note keeps the
 * lines that were written and loses the ones that were not; a wholly unwritten
 * one comes back empty, so the page can say so plainly instead of pretending.
 */
export function unfilled(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return true;
    return !/\[[^\]]*\]\s*$/.test(t);
  });

  // A heading whose every line was a placeholder is an empty promise: it names a
  // section the reader then finds nothing in. Drop the heading along with it.
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line.trim().startsWith("#")) {
      kept.push(line);
      continue;
    }
    const rest = lines.slice(i + 1);
    const nextHeading = rest.findIndex((l) => l.trim().startsWith("#"));
    const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
    if (body.some((l) => l.trim())) kept.push(line);
  }

  if (!kept.some((l) => l.trim() && !l.trim().startsWith("#"))) return "";
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function projectView(memory: string, project: string) {
  const roster = await readRoster(memory, project);
  if (!roster) return null;
  const logs = await readLogs(memory, project);
  const superseded = new Set(logs.map((l) => l.supersedes).filter(Boolean));
  const live = logs.filter((l) => !superseded.has(l.id));

  const note = unfilled(
    roster.text
      .replace(/^(?:\s|<!--[\s\S]*?-->)*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim(),
  );

  return {
    project,
    note,
    title: roster.fm.title && !String(roster.fm.title).startsWith("Insert") ? (roster.fm.title as string) : project,
    repos: roster.repos,
    teams: Array.isArray(roster.fm.teams) ? roster.fm.teams.filter((t: string) => !t.startsWith("Insert")) : [],
    handoff: live.find((l) => l.next)?.next ?? "",
    handoffBy: live.find((l) => l.next) ?? null,
    logs: live,
    count: logs.length,
    hasStandards: await exists(join(memory, project, "_standards.md")),
  };
}

/** The person axis: what one teammate has decided, across every project. */
export async function personView(memory: string, who: string) {
  const logs = (await readLogs(memory)).filter((l) => l.who === who);
  const file = join(memory, "_team", `_${who}`, "_profile.md");
  // Same rule as the project note: a scaffolded profile is prompts until someone
  // answers them, and "Role: [One line]" under a heading marked "curated" is
  // worse than saying nobody has written one.
  const profile = (await exists(file))
    ? unfilled(
        (await readFile(file, "utf8"))
          .replace(/^(?:\s|<!--[\s\S]*?-->)*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .trim(),
      )
    : "";
  return {
    who,
    profile,
    projects: [...new Set(logs.map((l) => l.project))].sort(),
    logs,
    count: logs.length,
  };
}

/** Rail counts for the three axes. */
export async function index(memory: string) {
  const logs = await readLogs(memory);
  const projects = await listProjects(memory);
  const byProject = Object.fromEntries(projects.map((p) => [p, 0]));
  const byPerson: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  for (const l of logs) {
    byProject[l.project] = (byProject[l.project] ?? 0) + 1;
    byPerson[l.who] = (byPerson[l.who] ?? 0) + 1;
    const month = l.date.slice(0, 7);
    if (month) byMonth[month] = (byMonth[month] ?? 0) + 1;
  }
  return { projects: byProject, people: byPerson, months: byMonth, total: logs.length };
}

/** How stale the clone is. A memory read from a week-old checkout is a week old. */
export async function age(memory: string): Promise<string> {
  try {
    const head = join(memory, ".git", "FETCH_HEAD");
    const target = (await exists(head)) ? head : join(memory, ".git");
    const { mtimeMs } = await stat(target);
    const mins = Math.floor((Date.now() - mtimeMs) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  } catch {
    return "unknown";
  }
}
