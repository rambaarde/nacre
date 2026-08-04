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
  risks: string[];
  next: string;
}

export interface Log extends LogSections {
  project: string; team: string; who: string;
  file: string; id: string; path: string; rel: string;
  date: string; stamp: string; repos: string[]; supersedes: string | null;
}

export interface Hit {
  date: string; who: string; project: string; repo: string;
  line: string; id: string; rel: string; against: boolean;
}

/** Sections a session log may carry, and the headings that introduce them. */
const SECTION = {
  against: /^#{1,6}\s*decided\s+against\b/i,
  risk: /^#{1,6}\s*(open\s+)?risks?\b/i,
  next: /^#{1,6}\s*next\b/i,
};

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
  const sections: Record<string, string[]> = { against: [], risk: [], next: [] };
  let current: string | null = null;
  const rest: string[] = [];

  for (const line of body.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+/.test(line);
    if (heading) {
      current = Object.keys(SECTION).find((k) => (SECTION[k as keyof typeof SECTION]).test(line)) ?? null;
      if (current) continue;
    }
    if (current) {
      const bucket = sections[current] as string[];
      if (line.trim()) bucket.push(line.trim());
      else if (bucket.length) bucket.push("");
    } else rest.push(line);
  }

  const clean = (arr: string[]): string[] =>
    arr.join("\n").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

  return {
    fm,
    body: body.trim(),
    summary: rest.join("\n").trim(),
    against: clean(sections.against as string[]),
    risks: clean(sections.risk as string[]),
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
        repo: log.repos[0] ?? log.project, line: line.replace(/^#{1,6}\s*/, ""),
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

/** Everything the project page needs, in the order it is read. */
export async function projectView(memory: string, project: string) {
  const roster = await readRoster(memory, project);
  if (!roster) return null;
  const logs = await readLogs(memory, project);
  const superseded = new Set(logs.map((l) => l.supersedes).filter(Boolean));
  const live = logs.filter((l) => !superseded.has(l.id));

  return {
    project,
    title: roster.fm.title && !String(roster.fm.title).startsWith("Insert") ? (roster.fm.title as string) : project,
    repos: roster.repos,
    teams: Array.isArray(roster.fm.teams) ? roster.fm.teams.filter((t: string) => !t.startsWith("Insert")) : [],
    handoff: live.find((l) => l.next)?.next ?? "",
    handoffBy: live.find((l) => l.next) ?? null,
    against: live.flatMap((l) => l.against.map((what) => ({ what, who: l.who, date: l.date, id: l.id }))),
    risks: live.flatMap((l) => l.risks.map((what) => ({ what, who: l.who, date: l.date, id: l.id }))),
    logs: live,
    count: logs.length,
  };
}

/** The person axis: what one teammate has decided, across every project. */
export async function personView(memory: string, who: string) {
  const logs = (await readLogs(memory)).filter((l) => l.who === who);
  return {
    who,
    projects: [...new Set(logs.map((l) => l.project))].sort(),
    against: logs.flatMap((l) => l.against.map((what) => ({ what, project: l.project, date: l.date, id: l.id }))),
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
