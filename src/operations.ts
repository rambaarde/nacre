/**
 * Operations — the only place product logic lives.
 *
 * Each is a plain function: typed input, typed result, no rendering. The CLI is
 * one thin adapter over these; a hosted worker would be another. That boundary
 * is kept from day one because the competitor this design learns from let their
 * CLI grow into the engine and is paying for the rewrite.
 *
 * Three setup acts, three operations, because they are done by different people
 * at different times:
 *
 *   initStore   once per company   create the centralised store
 *   addProject  once per project   create a project inside it
 *   linkRepo    once per repo      bind a repo to a project — BOTH records
 */

import {
  PKG_ROOT, AGENTS, exists, storePath, gitSlug, readRoster, addToRoster,
  listProjects, logStats, installSkills, resolveBinding, frontmatter,
  storeRemote, initGit, repoName, resolveStoreDir, isPubliclyReadable,
  readFile, writeFile, mkdir, cp, basename, join, resolve,
} from "./store.js";
import type { Binding } from "./store.js";

export interface InitInput {
  store?: string; storePath?: string; who?: string; force?: boolean;
  allowPublic?: boolean;
}
export interface AddInput {
  project?: string; title?: string; team?: string; repos?: string[];
  storePath?: string; store?: string | null; who?: string;
}
export interface LinkInput {
  repo?: string; project?: string; store?: string | null;
  storePath?: string; skipRoster?: boolean;
}
export interface LinkResult {
  dir: string; name: string; file: string; wrote: boolean;
  project: string; store: string; roster: { added: string[]; repos: string[] } | null;
}

/** Create the one centralised context store for a company. */
export async function initStore({ store, storePath: pathFlag, who, force, allowPublic }: InitInput) {
  const dir = await resolveStoreDir(pathFlag, store);

  // Refuse before creating anything. A memory holds production reasoning, and
  // a public one cannot be made private after the fact — the history is already
  // out and already cloneable.
  if (store && !allowPublic) {
    const open = await isPubliclyReadable(store);
    if (open === true) {
      throw new Error(
        `${store} is readable by anyone · a memory holds production reasoning ` +
          "and git history cannot be un-published · make it private, or pass " +
          "--i-know-its-public",
      );
    }
  }
  const already = await exists(join(dir, "_company.md"));
  if (already && !force) {
    return { dir, created: false, remote: await initGit(dir, store), projects: await listProjects(dir) };
  }

  const author = who ?? (await gitSlug());
  await mkdir(dir, { recursive: true });
  await cp(join(PKG_ROOT, "store-template", "_company.md"), join(dir, "_company.md"));
  await cp(join(PKG_ROOT, "store-template", "_standards.md"), join(dir, "_standards.md"));
  await cp(
    join(PKG_ROOT, "store-template", "_team", "_your-slug"),
    join(dir, "_team", `_${author}`),
    { recursive: true },
  );
  await writeFile(
    join(dir, ".gitignore"),
    "# Never leaves the machine.\n**/_drafts/\n.DS_Store\n",
  );
  const remote = await initGit(dir, store);
  return { dir, created: true, who: author, remote, projects: [] };
}

/** Add a project to the store. Optionally link repos in the same motion. */
export async function addProject({ project, title, team, repos, storePath: pathFlag, store, who }: AddInput) {
  if (!project) throw new Error("missing required argument: varve add <project>");
  const dir = await resolveStoreDir(pathFlag, store ?? (await resolveBinding())?.store);
  if (!(await exists(join(dir, "_company.md")))) {
    throw new Error(`no memory at ${dir} · run: varve init <git-url>`);
  }

  const author = who ?? (await gitSlug());
  const teamName = team ?? "devs";
  const projectDir = join(dir, project);
  const fresh = !(await exists(projectDir));

  if (fresh) {
    await cp(join(PKG_ROOT, "store-template", "PROJECT-TEMPLATE"), projectDir, { recursive: true });
    const file = join(projectDir, "_project.md");
    let text = await readFile(file, "utf8");
    text = text
      .replace(/^project:.*$/m, `project: ${project}`)
      .replace(/^title:.*$/m, `title: ${title ?? project}`)
      .replace(/^repos:.*$/m, `repos: []`)
      .replace(/^teams:.*$/m, `teams: [${teamName}]`)
      .replace(/^# \[Insert Display Name\]$/m, `# ${title ?? project}`);
    await writeFile(file, text);
    await mkdir(join(projectDir, teamName, author), { recursive: true });
  }

  const remote = store ?? (await storeRemote(dir));
  const linked: LinkResult[] = [];
  for (const repo of repos ?? []) {
    // Pass the resolved memory down. A repo being linked for the first time has
    // no binding of its own, so letting linkRepo re-derive would discard the
    // answer add already had — and fail outright when more than one memory
    // exists on the machine.
    linked.push(await linkRepo({ repo, project, storePath: dir, store: remote, skipRoster: true }));
  }
  const roster = linked.length
    ? await addToRoster(dir, project, linked.map((l) => l.name))
    : await readRoster(dir, project).then((r) => ({ repos: r?.repos ?? [], added: [] as string[] }));

  return { dir, project, created: fresh, team: teamName, who: author, linked, roster };
}

/**
 * Bind one code repo to a project — writing BOTH records.
 *
 * `.varve.yml` answers "which project am I, and where is the store"; the
 * project roster answers "which repos make up this project". They deliberately
 * answer different questions, so neither is a copy of the other — but a link
 * that updated only one of them would leave the company-level answer silently
 * wrong while every individual repo looked correctly wired.
 */
export async function linkRepo({ repo, project, store, storePath: pathFlag, skipRoster }: LinkInput): Promise<LinkResult> {
  const dir = resolve(repo ?? process.cwd());
  const name = basename(dir);
  if (!(await exists(dir))) throw new Error(`no such directory: ${dir}`);

  let remote = store;

  // Resolve the store URL rather than demanding it: an already-bound sibling
  // knows it, and failing that the store's own git remote is the record.
  if (!remote) remote = (await resolveBinding(dir))?.store;
  const storeDir = await resolveStoreDir(pathFlag, remote);
  if (!remote) remote = await storeRemote(storeDir);
  if (!remote) {
    throw new Error(
      `store at ${storeDir} has no git remote · pass --store <git-url>, ` +
        `or set one: git -C ${storeDir} remote add origin <git-url>`,
    );
  }
  if (!project) throw new Error("missing required flag: --project <name>");

  const file = join(dir, ".varve.yml");
  let wrote = false;
  if (await exists(file)) {
    const current = frontmatter(`---\n${await readFile(file, "utf8")}\n---`);
    if (current.project && current.project !== project) {
      throw new Error(
        `${file} already binds this repo to "${current.project}", not "${project}". ` +
          `Resolve it by hand — rebinding a repo silently would point it at the wrong memory.`,
      );
    }
  } else {
    await writeFile(file, `project: ${project}\nmemory: ${remote}\n`);
    wrote = true;
  }

  const roster = skipRoster ? null : await addToRoster(storeDir, project as string, [name]);
  return { dir, name, file, wrote, project: project as string, store: remote as string, roster };
}

export interface LogStats { count: number; newest: string | null; who: string | null }

/**
 * A discriminated union rather than one loose shape, so a renderer cannot read
 * a field that does not exist in the state it is rendering — `binding` is only
 * present once there is one.
 */
export type Status =
  | { state: "no-store"; store: string; projects: string[] }
  | { state: "no-binding"; store: string; projects: string[] }
  | { state: "unknown-project"; store: string; projects: string[]; binding: BoundBinding }
  | {
      state: "ready"; store: string; binding: BoundBinding; repos: string[];
      logs: LogStats; here: string; skillsReady: boolean;
    };

/** A binding that has been checked to actually name a project. */
export type BoundBinding = Binding & { project: string };

/** Live state for the bare `varve` command. Read-only, no side effects. */
export async function status({ storePath: pathFlag }: { storePath?: string } = {}): Promise<Status> {
  const binding = await resolveBinding();
  const dir = await resolveStoreDir(pathFlag, binding?.store);
  const storeReady = await exists(join(dir, "_company.md"));
  const projects = await listProjects(dir);

  if (!storeReady) return { state: "no-store", store: dir, projects };
  if (!binding?.project) return { state: "no-binding", store: dir, projects };

  const bound = binding as BoundBinding;
  const project = bound.project;
  const roster = await readRoster(dir, project);
  if (!roster) return { state: "unknown-project", store: dir, projects, binding: bound };

  const logs = await logStats(dir, project);
  const skillsReady = await exists(join(AGENTS.claude, "varve-load", "SKILL.md"));
  return {
    state: "ready", store: dir, binding: bound, repos: roster.repos, logs,
    here: basename(binding.dir), skillsReady,
  };
}

export { installSkills };
