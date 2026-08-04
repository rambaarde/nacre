/**
 * Store access — paths, bindings, and the project roster.
 *
 * Everything that touches the filesystem or reads YAML lives here so the
 * operations layer stays about meaning rather than I/O. Zero dependencies:
 * node: builtins only.
 *
 * The frontmatter reader is deliberately minimal. varve's store is markdown
 * that tooling reads, not a format tooling owns — a file it cannot fully parse
 * must still render, still grep, and still count.
 */

import { access, readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Agent skill directories we know how to install into. */
export const AGENTS = {
  claude: join(homedir(), ".claude", "skills"),
  opencode: join(homedir(), ".config", "opencode", "skills"),
};

export const exists = (p) => access(p).then(() => true, () => false);

/** Read `key: value` pairs from a YAML frontmatter block. Lists become arrays. */
export function frontmatter(text) {
  // Tolerate leading comments or blank lines before the block: a file that
  // cannot be fully parsed must still be readable, not silently empty.
  const block = text.match(/^(?:\s|<!--[\s\S]*?-->)*---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!block) return {};
  const out = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    const value = raw.replace(/\s+#.*$/, "").trim();
    out[key] = value.startsWith("[")
      ? value.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean)
      : value;
  }
  return out;
}

/** Replace one frontmatter key in place, preserving everything else verbatim. */
export function setFrontmatterKey(text, key, value) {
  const rendered = Array.isArray(value) ? `[${value.join(", ")}]` : value;
  const line = `${key}: ${rendered}`;
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  return text.replace(/^---\r?\n/, `---\n${line}\n`);
}

/**
 * Walk up from `start` looking for `.varve.yml`.
 *
 * Returns null rather than guessing. There is deliberately no global default
 * store: a fallback is the one mechanism by which one company's notes could be
 * written into another company's store, so failing loudly is the feature.
 */
export async function resolveBinding(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    const file = join(dir, ".varve.yml");
    if (await exists(file)) {
      const fm = frontmatter(`---\n${await readFile(file, "utf8")}\n---`);
      return { file, dir, project: fm.project, store: fm.store };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Local store path: explicit flag → env → default. */
export const storePath = (flag) =>
  resolve(flag ?? process.env.VARVE_STORE ?? join(homedir(), "company-context"));

/**
 * The store's own git remote is the record of where the store lives.
 *
 * Not a second copy of the URL: the store is a git repository, so `origin` is
 * already the answer, and reading it means the two can never drift.
 */
export async function storeRemote(dir) {
  try {
    const { stdout } = await run("git", ["-C", dir, "remote", "get-url", "origin"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Make the store a real git repo with its remote set. Safe to re-run. */
export async function initGit(dir, remote) {
  try {
    await run("git", ["-C", dir, "rev-parse", "--git-dir"]);
  } catch {
    await run("git", ["-C", dir, "init", "-q"]);
  }
  if (!remote) return await storeRemote(dir);
  const current = await storeRemote(dir);
  if (!current) await run("git", ["-C", dir, "remote", "add", "origin", remote]);
  else if (current !== remote) return current; // never silently re-point a remote
  return remote;
}

/** Author slug from git config. Wrong harmlessly; never blocks. */
export async function gitSlug() {
  try {
    const { stdout } = await run("git", ["config", "user.name"]);
    return stdout.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "you";
  } catch {
    return "you";
  }
}

export async function readRoster(store, project) {
  const file = join(store, project, "_project.md");
  if (!(await exists(file))) return null;
  const text = await readFile(file, "utf8");
  const fm = frontmatter(text);
  const repos = Array.isArray(fm.repos) ? fm.repos : [];
  // A freshly copied template still carries its placeholder; treat that as empty.
  return { file, text, fm, repos: repos.filter((r) => !r.startsWith("Insert")) };
}

/** Add repos to a project's roster. Union, never overwrite — two people adding
 *  repos the same afternoon should not erase each other's work. */
export async function addToRoster(store, project, repos) {
  const roster = await readRoster(store, project);
  if (!roster) throw new Error(`no project "${project}" in ${store} · run: varve add ${project}`);
  const merged = [...new Set([...roster.repos, ...repos])].sort();
  await writeFile(roster.file, setFrontmatterKey(roster.text, "repos", merged));
  return { added: merged.filter((r) => !roster.repos.includes(r)), repos: merged };
}

export async function listProjects(store) {
  if (!(await exists(store))) return [];
  const entries = await readdir(store, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;
    if (await exists(join(store, e.name, "_project.md"))) out.push(e.name);
  }
  return out.sort();
}

/** Count session logs for a project, and find the newest. */
export async function logStats(store, project) {
  const root = join(store, project);
  if (!(await exists(root))) return { count: 0, newest: null, who: null };
  let count = 0, newest = null, who = null;
  const teams = await readdir(root, { withFileTypes: true });
  for (const team of teams) {
    if (!team.isDirectory() || team.name.startsWith("_")) continue;
    const people = await readdir(join(root, team.name), { withFileTypes: true });
    for (const person of people) {
      if (!person.isDirectory()) continue;
      const files = (await readdir(join(root, team.name, person.name)))
        .filter((f) => f.endsWith(".md"));
      count += files.length;
      for (const f of files) {
        if (!newest || f > newest) { newest = f; who = person.name; }
      }
    }
  }
  return { count, newest, who };
}

export async function installSkills(agents) {
  const installed = [];
  for (const name of agents) {
    const dest = AGENTS[name];
    if (!dest) continue;
    for (const skill of ["varve-load", "varve-publish"]) {
      await mkdir(join(dest, skill), { recursive: true });
      await cp(join(PKG_ROOT, "skills", skill), join(dest, skill), { recursive: true });
    }
    installed.push(name);
  }
  return installed;
}

export { readFile, writeFile, mkdir, cp, basename, join, resolve };
