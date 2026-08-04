/**
 * `varve init` — wire a code repo to a company context store.
 *
 * This is an installer, not the memory engine. It copies the skills into place,
 * writes the per-repo binding, and optionally scaffolds a new store. Reading and
 * writing memory stay in the skills themselves; nothing here touches log
 * content, which is why there is no operations layer to speak of yet.
 *
 * Zero runtime dependencies — node: builtins only. The whole point of the
 * install story is that it works on a stranger's machine.
 */

import { mkdir, readFile, writeFile, cp, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";

const run = promisify(execFile);
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Agent skill locations we know how to install into. */
const AGENTS = {
  claude: join(homedir(), ".claude", "skills"),
  opencode: join(homedir(), ".config", "opencode", "skills"),
};

const exists = (p) => access(p).then(() => true, () => false);

/**
 * Ask a question, or return the default when there is no TTY.
 * AXI forbids blocking on input: every prompt must have a flag equivalent, and
 * a headless run must never hang waiting for a human.
 */
async function ask(rl, question, fallback) {
  if (!rl) return fallback;
  const answer = (await rl.question(`${question}${fallback ? ` (${fallback})` : ""}: `)).trim();
  return answer || fallback;
}

/** Best-effort author slug, from git config. Wrong harmlessly; never blocks. */
async function gitSlug() {
  try {
    const { stdout } = await run("git", ["config", "user.name"]);
    return stdout.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "you";
  } catch {
    return "you";
  }
}

/** Copy the two skills into every requested agent's skills directory. */
async function installSkills(agents) {
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

/**
 * Write the per-repo binding.
 *
 * Two lines, and both matter. `project` is what scopes every read; `store` is
 * what lets a teammate clone this repo and start warm without ever running
 * init. It is committed deliberately — an uncommitted binding means everyone
 * repeats setup by hand, and most will not.
 *
 * Refuses to silently overwrite a different project's binding: that would
 * re-point a repo at the wrong memory without anyone noticing.
 */
async function writeBinding(repoPath, project, store) {
  const file = join(repoPath, ".varve.yml");
  if (await exists(file)) {
    const current = await readFile(file, "utf8");
    const found = current.match(/^project:\s*(\S+)/m)?.[1];
    if (found && found !== project) {
      throw new Error(
        `${file} already binds this repo to "${found}", not "${project}". ` +
          `Resolve it by hand — rebinding a repo silently would point it at the wrong memory.`,
      );
    }
    return { file, changed: false };
  }
  await writeFile(file, `project: ${project}\nstore: ${store}\n`);
  return { file, changed: true };
}

/** Scaffold a new store from the template. Never touches an existing one. */
async function scaffoldStore(storePath, project, who) {
  if (await exists(join(storePath, "_company.md"))) return { created: false };

  await mkdir(storePath, { recursive: true });
  await cp(join(PKG_ROOT, "store-template", "_company.md"), join(storePath, "_company.md"));
  await cp(join(PKG_ROOT, "store-template", "_standards.md"), join(storePath, "_standards.md"));
  await cp(
    join(PKG_ROOT, "store-template", "_team", "_your-slug"),
    join(storePath, "_team", `_${who}`),
    { recursive: true },
  );
  await cp(
    join(PKG_ROOT, "store-template", "PROJECT-TEMPLATE"),
    join(storePath, project),
    { recursive: true },
  );
  await mkdir(join(storePath, project, "devs", who), { recursive: true });
  return { created: true };
}

/**
 * @param {object} opts parsed flags
 * @param {boolean} interactive whether a TTY is available for prompts
 */
export async function init(opts, interactive) {
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    const repoPath = resolve(opts.repo ?? process.cwd());
    const who = opts.who ?? (await gitSlug());

    const project = opts.project ?? (await ask(rl, "project slug", null));
    if (!project) throw new Error("missing required flag: --project <name>");

    const store = opts.store ?? (await ask(rl, "store git url", null));
    if (!store) throw new Error("missing required flag: --store <git-url>");

    const storePath = resolve(opts["store-path"] ?? join(homedir(), "company-context"));
    const agents = (opts.agents ?? "claude").split(",").map((a) => a.trim()).filter(Boolean);

    const installed = await installSkills(agents);
    const binding = await writeBinding(repoPath, project, store);
    const scaffold = opts["create-store"] ? await scaffoldStore(storePath, project, who) : { created: false };

    return { project, store, storePath, who, repoPath, installed, binding, scaffold };
  } finally {
    rl?.close();
  }
}
