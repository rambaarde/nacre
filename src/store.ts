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
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
/**
 * The package root, found by walking up for package.json rather than counting
 * directories. Source runs from src/ and the build runs from dist/src/, so a
 * fixed number of `..` is right in exactly one of them — and wrong silently in
 * the other, since it only fails when a template is actually read.
 */
function findPackageRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

export const PKG_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * The agents whose conventions we know how to write.
 *
 * `home` is what proves the agent is installed; `dir` is where its instructions
 * go. Most of them settled on the same shape — a directory per skill holding a
 * SKILL.md — so one file serves four of the five. Cursor wants a single `.mdc`
 * per rule instead, which is a format difference, not a capability one.
 *
 * varve was never Claude-only by design; this table simply had two rows.
 */
export interface AgentTarget {
  label: string;
  /** Its config root. Present means the agent is installed on this machine. */
  home: string;
  /** Where its instruction files belong. */
  dir: string;
  layout: "skill" | "rule";
}

export const AGENTS: Record<string, AgentTarget> = {
  claude: {
    label: "Claude Code",
    home: join(homedir(), ".claude"),
    dir: join(homedir(), ".claude", "skills"),
    layout: "skill",
  },
  codex: {
    label: "Codex",
    home: join(homedir(), ".codex"),
    dir: join(homedir(), ".codex", "skills"),
    layout: "skill",
  },
  gemini: {
    label: "Gemini CLI",
    home: join(homedir(), ".gemini"),
    dir: join(homedir(), ".gemini", "skills"),
    layout: "skill",
  },
  opencode: {
    label: "OpenCode",
    home: join(homedir(), ".config", "opencode"),
    dir: join(homedir(), ".config", "opencode", "skills"),
    layout: "skill",
  },
  cursor: {
    label: "Cursor",
    home: join(homedir(), ".cursor"),
    dir: join(homedir(), ".cursor", "rules"),
    layout: "rule",
  },
};

/**
 * Which agents are actually on this machine.
 *
 * Installing only where an agent exists beats a default of "claude": a team
 * where one person uses Cursor and another Codex should not each have to learn
 * a flag, and writing skill files into a config directory for a tool nobody has
 * is litter.
 */
export async function detectAgents(): Promise<string[]> {
  const found = await Promise.all(
    Object.entries(AGENTS).map(async ([name, a]) => ((await exists(a.home)) ? name : null)),
  );
  return found.filter((n): n is string => n !== null);
}

export const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);

/** Read `key: value` pairs from a YAML frontmatter block. Lists become arrays. */
export type Frontmatter = Record<string, string | string[]>;

export function frontmatter(text: string): Frontmatter {
  // Tolerate leading comments or blank lines before the block: a file that
  // cannot be fully parsed must still be readable, not silently empty.
  const block = text.match(/^(?:\s|<!--[\s\S]*?-->)*---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!block) return {};
  const out: Frontmatter = {};
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] as string).match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1] as string;
    const raw = m[2] as string;
    const value = raw.replace(/\s+#.*$/, "").trim();

    // Block scalars: `description: >` followed by indented lines. Every skill
    // this project ships is written that way, and reading only the first line
    // yielded the literal ">" as the description — which then became the text
    // Cursor shows a user when deciding whether to run the command.
    if (/^[>|][-+]?$/.test(value)) {
      const body: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] as string)) {
        body.push((lines[++i] as string).trim());
      }
      out[key] = value.startsWith("|") ? body.join("\n") : body.join(" ");
      continue;
    }

    out[key] = value.startsWith("[")
      ? value.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean)
      : value;
  }
  return out;
}

/** Replace one frontmatter key in place, preserving everything else verbatim. */
export function setFrontmatterKey(text: string, key: string, value: string | string[]): string {
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
export interface Binding { file: string; dir: string; project?: string; store?: string }

export async function resolveBinding(start: string = process.cwd()): Promise<Binding | null> {
  let dir = resolve(start);
  for (;;) {
    const file = join(dir, ".varve.yml");
    if (await exists(file)) {
      const fm = frontmatter(`---\n${await readFile(file, "utf8")}\n---`);
      // `store:` accepted as the former spelling of `memory:`.
      return { file, dir, project: fm.project as string, store: (fm.memory ?? fm.store) as string };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The repo name from a git URL: git@host:acme/acme-context.git → acme-context */
export function repoName(url?: string | null): string | null {
  if (!url) return null;
  // Backslash is a separator too. Without it a Windows memory path —
  // `C:\\work\\acme-context.git` — yielded a "name" containing separators,
  // which isSafeName then rejected, so resolution fell through to scanning the
  // home directory and could return SOMEONE ELSE'S memory. That is the one
  // failure this design refuses to allow.
  const last = url.trim().replace(/\.git$/, "").split(/[/:\\]/).pop();
  // A remote path is allowed to contain spaces and non-Latin characters; only a
  // name that is not a single directory name is unusable. `[\w.-]+` rejected
  // `acme context.git` and silently fell back to the default directory, so two
  // companies could land in one.
  return last && isSafeName(last) && last !== "." && last !== ".." ? last : null;
}

/**
 * Local memory path: explicit flag → env → derived from the memory URL → default.
 *
 * Derived from the URL rather than hardcoded, because every company names its
 * store repo differently and someone working for two of them would otherwise
 * have both collide on one directory.
 */
export const storePath = (flag?: string, url?: string | null): string =>
  resolve(
    flag ??
      process.env.VARVE_STORE ??
      join(homedir(), repoName(url) ?? "company-context"),
  );

/**
 * The store's own git remote is the record of where the store lives.
 *
 * Not a second copy of the URL: the store is a git repository, so `origin` is
 * already the answer, and reading it means the two can never drift.
 */
export async function storeRemote(dir: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", dir, "remote", "get-url", "origin"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Make the store a real git repo with its remote set. Safe to re-run. */
export async function initGit(dir: string, remote?: string | null): Promise<string | null> {
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

/**
 * Is this remote readable without credentials?
 *
 * A memory holds production reasoning, unpatched-but-known issues, and the
 * reasons behind decisions nobody wrote down elsewhere. Publishing that by
 * accident is not recoverable — git history is permanent and already cloned.
 *
 * The check is a plain anonymous fetch with every credential path disabled:
 * no terminal prompt, no askpass, no credential helper, no SSH agent. If the
 * refs come back anyway, anyone can read it. SSH remotes are rewritten to HTTPS
 * first, since an SSH probe would authenticate as the user and always succeed.
 *
 * Returns null when the answer cannot be established — offline, unknown host,
 * a private mirror. Unknown must never read as "public", or the guard would
 * fire on people it should not.
 */
/**
 * Is there work here that no remote has seen — uncommitted files, or commits on
 * no remote-tracking branch?
 *
 * `varve add` used to end with "teammates then need nothing", which is true of
 * `.varve.yml` and false of everything else until the memory itself is pushed.
 * A teammate cloning a wired repo before that gets a binding pointing at an
 * empty remote.
 */
export async function memoryNeedsPush(dir: string): Promise<boolean> {
  try {
    const { stdout: dirty } = await run("git", ["-C", dir, "status", "--porcelain"]);
    if (dirty.trim()) return true;
    const { stdout: ahead } = await run("git", [
      "-C", dir, "log", "--branches", "--not", "--remotes", "--oneline",
    ]);
    return ahead.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Does this remote already hold a history? Asked with the caller's own
 * credentials, unlike `isPubliclyReadable`, which deliberately strips them.
 *
 * `null` means the question could not be answered — offline, no access, no such
 * repo. That is not the dangerous case: a remote nobody can reach is a remote
 * nobody can push a divergent history to. The dangerous case is a remote that is
 * reachable and already has a memory on it, and that is exactly `true`.
 */
export async function remoteHasCommits(url: string): Promise<boolean | null> {
  try {
    const { stdout } = await run("git", ["ls-remote", "--heads", url], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" },
      timeout: 15_000,
    });
    return stdout.trim().length > 0;
  } catch {
    return null;
  }
}

export async function isPubliclyReadable(url: string): Promise<boolean | null> {
  const https = url
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://");
  if (!https.startsWith("https://")) return null;

  try {
    await run("git", ["ls-remote", "--heads", https], {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        SSH_ASKPASS: "",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
      },
      timeout: 10_000,
    });
    return true;
  } catch (error) {
    const text = String((error as { stderr?: string })?.stderr ?? error);
    // Authentication being demanded is the signal we want: the repo is there
    // and it will not show itself to a stranger.
    if (/Authentication failed|could not read Username|terminal prompts disabled|denied|403|401/i.test(text)) {
      return false;
    }
    return null;
  }
}

/**
 * Clone the memory if it is not here yet.
 *
 * This is the whole onboarding promise: a teammate clones one code repo, runs
 * nothing, and their next session is warm. The binding already says where the
 * memory lives, so asking them to run `init` would be both unnecessary and
 * wrong — init creates a *new* memory rather than joining the existing one.
 *
 * Never interactive. Without credentials git would sit waiting for a password
 * and hang the session, which is a worse first impression than a clear message.
 */
/**
 * `git@github.com:acme/acme-context.git` → `acme/acme-context`.
 *
 * Null for anything that is not a GitHub remote — a self-hosted memory is
 * legitimate, and guessing a collaborator API for it would fail confusingly.
 */
export function githubSlug(remote?: string | null): string | null {
  if (!remote) return null;
  const m = remote.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
  return m ? (m[1] as string) : null;
}

/**
 * Invite someone to the memory.
 *
 * This is the one step that cannot be automated away and is not optional: the
 * memory is private, so a teammate reads nothing and pushes nothing until they
 * are on it. It was also the only part of onboarding that lived entirely in a
 * browser, which is why it sat between "clone the repo" and "start warm".
 *
 * `gh` is used when present and never installed — this package has no runtime
 * dependencies, and a tool that quietly installs a second CLI is not one.
 */
export async function invite(remote: string | null, who: string): Promise<
  { ok: true; via: "gh" } | { ok: false; url: string | null; reason: string }
> {
  const slug = githubSlug(remote);
  const url = slug ? `https://github.com/${slug}/settings/access` : null;
  if (!slug) return { ok: false, url, reason: `${remote ?? "the memory"} is not a GitHub remote — add them however it is hosted` };

  try {
    await run("gh", ["api", "--method", "PUT", `repos/${slug}/collaborators/${who}`, "-f", "permission=push"], {
      timeout: 30_000,
    });
    return { ok: true, via: "gh" };
  } catch (error) {
    const text = String((error as { stderr?: string })?.stderr ?? error).trim().split("\n").pop();
    return { ok: false, url, reason: text ?? "gh failed" };
  }
}

export async function ensureMemory(dir: string, remote?: string | null): Promise<
  { ok: true; cloned: boolean } | { ok: false; reason: string; denied?: boolean }
> {
  if (await exists(join(dir, "_company.md"))) return { ok: true, cloned: false };
  if (!remote) return { ok: false, reason: "no memory here, and nothing says where it lives" };

  try {
    await run("git", ["clone", "--quiet", remote, dir], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" },
      timeout: 60_000,
    });
  } catch (error) {
    const raw = String((error as { stderr?: string })?.stderr ?? error).trim();
    const text = raw.split("\n").pop();

    // Being denied is not the same as being broken, and it is the likeliest
    // failure a new teammate hits: the memory is private, and nobody has added
    // them yet. Saying "could not clone" sends them to debug git; saying who to
    // ask is the whole fix.
    if (/permission denied|access rights|authentication failed|not found|could not read from remote|repository not found/i.test(raw)) {
      return {
        ok: false,
        denied: true,
        reason:
          `no access to ${remote} — the memory is private and you are not on it yet. ` +
          "Ask whoever set it up to run: varve invite <your-github-username>",
      };
    }
    return { ok: false, reason: `could not clone ${remote} — ${text}` };
  }

  if (await exists(join(dir, "_company.md"))) return { ok: true, cloned: true };
  return { ok: false, reason: `${remote} does not look like a varve memory (no _company.md)` };
}

/** Name and email from git config. Absent is fine; it is a profile, not a form. */
export async function gitIdentity(): Promise<{ name?: string; email?: string }> {
  const read = async (key: string) => {
    try {
      return (await run("git", ["config", key])).stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  };
  return { name: await read("user.name"), email: await read("user.email") };
}

/**
 * Turn a person's name into the directory their logs file under.
 *
 * This used to be `[^a-z0-9-] → "-"`, which is fine for `Dana Reyes` and
 * ruinous otherwise: `李明`, `Дмитрий` and `محمد` each became `"-"`, so two
 * colleagues with non-Latin names collided into one identity — and `José` came
 * out as `jos-`. For a store whose point is that no teammate is left out, a
 * name it cannot spell is the wrong thing to be lossy about.
 *
 * Diacritics are folded so `María` and `Maria` do not become two people, and
 * every script's letters and digits are kept, because a directory name is
 * allowed to be Unicode and the person's name is the honest slug.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    // Fold diacritics off Latin letters only. Stripping them everywhere turned
    // `Дмитрий` into `дмитрии` — the Cyrillic и-with-breve is a distinct letter,
    // not an accent, and flattening it merges names that are not the same.
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    // Recompose, so a mark that was deliberately kept rejoins its base instead
    // of being left loose and swept into a hyphen by the rule below.
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    || "you";
}

/** Author slug from git config. Wrong harmlessly; never blocks. */
export async function gitSlug(): Promise<string> {
  try {
    const { stdout } = await run("git", ["config", "user.name"]);
    return slugify(stdout.trim());
  } catch {
    return "you";
  }
}

/**
 * Find every store directly under the home directory.
 *
 * Used only when nothing else identifies a store. Discovery is not guessing:
 * finding exactly one is unambiguous, and finding several is reported rather
 * than resolved, because picking one silently is how a contractor's notes end
 * up in the wrong company's store.
 */
export async function discoverStores(): Promise<string[]> {
  const home = homedir();
  let entries;
  try {
    entries = await readdir(home, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if (await exists(join(home, e.name, "_company.md"))) found.push(join(home, e.name));
  }
  return found.sort();
}

/** Resolve which store to use: flag → env → store URL → discovery. */
/**
 * Walk up from `from` looking for a directory that IS a memory.
 *
 * Standing inside one is the plainest possible statement of which memory you
 * mean, and it was the one thing resolution never checked: `varve serve` run
 * from the root of a memory reported "no memory here, and nothing says where it
 * lives" — while standing in one — because discovery only ever looked directly
 * under the home directory.
 */
async function findMemoryUp(from: string): Promise<string | null> {
  let dir = resolve(from);
  for (;;) {
    if (await exists(join(dir, "_company.md"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function resolveStoreDir(flag?: string, url?: string | null): Promise<string> {
  if (flag) {
    // A bare name means "the memory called that", not a directory under cwd.
    // Backslash and a drive letter count as "this is a path": on Windows
    // `C:\\memories\\acme` contains no forward slash, so it was read as a name
    // and joined onto the home directory — pointing at somewhere that does not
    // exist while looking like it worked.
    const looksLikePath =
      flag.includes("/") || flag.includes("\\") || /^[A-Za-z]:/.test(flag) || flag.startsWith(".");
    if (!looksLikePath) {
      const named = join(homedir(), flag);
      if (await exists(join(named, "_company.md"))) return named;
    }
    return resolve(flag);
  }
  if (process.env.VARVE_STORE) return resolve(process.env.VARVE_STORE);

  // A `memory:` that is already a local directory IS the memory. Deriving
  // ~/<name> from it and cloning there instead is not a fallback, it is a wrong
  // answer: `.varve.yml` is the record of where the memory lives, and a path
  // that resolves is an answer rather than a hint. This bit every store without
  // a remote — a company still working locally — and reported "this memory has
  // no projects yet" while pointing at a directory full of them.
  if (url && !url.includes("://") && !/^[^/\\]+@[^/\\]+:/.test(url)) {
    const local = resolve(url);
    if (await exists(join(local, "_company.md"))) return local;
  }

  const derived = repoName(url);
  if (derived) return join(homedir(), derived);

  // Checked before discovery: a memory you are standing in beats one found by
  // scanning, and it removes the "several memories found" prompt in the one case
  // where the answer is unambiguous.
  const here = await findMemoryUp(process.cwd());
  if (here) return here;

  const found = await discoverStores();
  if (found.length === 1) return found[0] as string;
  if (found.length > 1) {
    throw new Error(
      `several memories found: ${found.map((f) => basename(f)).join(", ")} · ` +
        "pass --memory <name> — picking one silently could write into the wrong company's memory",
    );
  }
  return join(homedir(), "company-context");
}

export interface Roster { file: string; text: string; fm: Frontmatter; repos: string[] }

/**
 * A project or person name is ONE directory name inside the memory — never a
 * path. Rejecting the rest here, at the only layer that turns a name into a
 * file, protects every caller including ones not written yet.
 *
 * The portal decodes URL parameters, and `%2e%2e%2f` survives Node's path
 * normalisation to become `../` afterwards, so `/s/%2e%2e%2foutside` read a
 * file outside the memory. Guarding the two routes would have left the next
 * route to rediscover it.
 */
export function isSafeName(name: string): boolean {
  return name.length > 0
    && name !== "."
    && name !== ".."
    && !name.includes("/")
    && !name.includes("\\")
    && !name.includes("\0");
}

export async function readRoster(store: string, project: string): Promise<Roster | null> {
  if (!isSafeName(project)) return null;
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
export async function addToRoster(store: string, project: string, repos: string[]) {
  const roster = await readRoster(store, project);
  if (!roster) throw new Error(`no project "${project}" in ${store} · run: varve add ${project}`);
  const merged = [...new Set([...roster.repos, ...repos])].sort();
  await writeFile(roster.file, setFrontmatterKey(roster.text, "repos", merged));
  return { added: merged.filter((r) => !roster.repos.includes(r)), repos: merged };
}

export async function listProjects(store: string): Promise<string[]> {
  if (!(await exists(store))) return [];
  const entries = await readdir(store, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;
    if (await exists(join(store, e.name, "_project.md"))) out.push(e.name);
  }
  return out.sort();
}

/** Count session logs for a project, and find the newest. */
export async function logStats(store: string, project: string) {
  if (!isSafeName(project)) return { count: 0, newest: null, who: "" };
  const root = join(store, project);
  if (!(await exists(root))) return { count: 0, newest: null, who: null };
  let count = 0;
  let newest: string | null = null;
  let who: string | null = null;
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

export const SKILLS = ["varve-load", "varve-publish"] as const;

/**
 * Cursor reads one `.mdc` per rule, not a directory per skill.
 *
 * `alwaysApply: false` on purpose — these describe what to do at the start and
 * end of a session, not a rule that should ride along in every request. Loading
 * them into every prompt would spend tokens on instructions that apply twice a
 * day.
 */
function asRule(skill: string, text: string): string {
  const fm = frontmatter(text);
  const description = String(fm.description ?? `varve — ${skill}`)
    .replace(/\s+/g, " ")
    .trim();
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  return `---\ndescription: ${description}\nglobs:\nalwaysApply: false\n---\n\n${body}\n`;
}

/** Are the two commands already installed for this agent, in its own format? */
export async function skillsInstalled(name: string): Promise<boolean> {
  const target = AGENTS[name];
  if (!target) return false;
  return target.layout === "rule"
    ? exists(join(target.dir, `${SKILLS[0]}.mdc`))
    : exists(join(target.dir, SKILLS[0], "SKILL.md"));
}

export async function installSkills(agents: string[]): Promise<string[]> {
  const installed: string[] = [];
  for (const name of agents) {
    const target = AGENTS[name];
    if (!target) continue;
    for (const skill of SKILLS) {
      const source = join(PKG_ROOT, "skills", skill);
      if (target.layout === "rule") {
        await mkdir(target.dir, { recursive: true });
        const text = await readFile(join(source, "SKILL.md"), "utf8");
        await writeFile(join(target.dir, `${skill}.mdc`), asRule(skill, text));
        continue;
      }
      await mkdir(join(target.dir, skill), { recursive: true });
      await cp(source, join(target.dir, skill), { recursive: true });
    }
    installed.push(name);
  }
  return installed;
}

export { readFile, writeFile, mkdir, cp, basename, join, resolve };
