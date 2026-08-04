#!/usr/bin/env node
/**
 * varve CLI — argv in, one operation, rendered result out.
 *
 * No product logic here by design; it all lives in src/operations.mjs.
 *
 * Output follows AXI (https://axi.md/): structured lines on stdout, explicit
 * empty states, and every command ending in the next command to run — so nobody
 * has to memorise a sequence. Exit 0 success / 1 error / 2 unknown flag.
 */

import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initStore, addProject, status, installSkills } from "../src/operations.mjs";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const OPTIONS = {
  "memory-path": { type: "string" },
  "store-path": { type: "string" }, // former spelling
  title: { type: "string" },
  team: { type: "string" },
  who: { type: "string" },
  agents: { type: "string" },
  force: { type: "boolean" },
  "no-skills": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
};

const USAGE = `varve — one git-backed memory for a whole company

  varve                          where am I, and what is next
  varve init <git-url>           create the company memory     (once)
  varve add  <project> [dir...]  add a project, and its repos  (as needed)

  also works as \`vrv\`

Adding repos to an existing project is the same command again:
  varve add ims ../ims-worker

  --memory-path <dir>  local clone path  (default: from the repo name)
  --team <name>        team folder       (default: devs)
  --title <name>       display name
  --who <slug>         author slug       (default: from git config)
  --agents <a,b>       claude,opencode   (default: claude)
  --no-skills          skip installing the skills

Reading and writing memory happen through the skills, not this binary.`;

const out = (...lines) => lines.filter(Boolean).forEach((l) => console.log(l));

function fail(message, code = 1) {
  console.log(`error: ${message}`);
  console.log("help[]: varve --help");
  process.exit(code);
}

/** Bare `varve` — live state, and the single next command that applies. */
function renderStatus(s) {
  if (s.state === "no-store") {
    return out(
      `no memory at ${s.store}`,
      "next: varve init --store <git-url>",
      "help[]: varve --help",
    );
  }
  if (s.state === "no-binding") {
    return out(
      `memory: ${s.store} · projects[${s.projects.length}]: ${s.projects.join(", ") || "none yet"}`,
      "this directory is not bound to a project",
      s.projects.length
        ? `next: varve add <${s.projects.join("|")}> .`
        : "next: varve add <project> .",
      "help[]: varve --help",
    );
  }
  if (s.state === "unknown-project") {
    return out(
      `error: .varve.yml names "${s.binding.project}", which is not in ${s.store}`,
      `projects[${s.projects.length}]: ${s.projects.join(", ") || "none"}`,
      `next: varve add ${s.binding.project}`,
    );
  }
  const { binding, repos, logs, here, skillsReady } = s;
  out(
    `project: ${binding.project} · repos[${repos.length}]: ${repos.join(", ") || "none linked"} · ` +
      `logs: ${logs.count}${logs.newest ? ` · last: ${logs.newest.replace(/\.md$/, "")} (${logs.who})` : ""}`,
    `memory: ${s.store}${here ? ` · you are in: ${here}` : ""}`,
    logs.count === 0
      ? "no logs yet · next: varve-publish at the end of this session"
      : "next: varve-load at the start of a session · varve-publish at the end",
    skillsReady ? null : "warn: skills not installed · next: varve add " + binding.project + " .",
  );
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ options: OPTIONS, allowPositionals: true, args: process.argv.slice(2) });
  } catch (error) {
    fail(error.message, 2);
  }
  const { values: o, positionals } = parsed;
  const [command, arg] = positionals;

  if (o.version) {
    const pkg = JSON.parse(await readFile(join(PKG_ROOT, "package.json"), "utf8"));
    return console.log(pkg.version);
  }
  if (o.help || command === "help") return console.log(USAGE);

  const memoryPath = o["memory-path"] ?? o["store-path"];
  const agents = (o.agents ?? "claude").split(",").map((a) => a.trim()).filter(Boolean);

  try {
    // Bare `varve` shows live state, never a usage dump.
    if (!command) return renderStatus(await status({ storePath: memoryPath }));

    if (command === "init") {
      if (!arg && !memoryPath) fail("missing argument: varve init <git-url>");
      const r = await initStore({ store: arg, storePath: memoryPath, who: o.who, force: o.force });
      if (!r.created) {
        return out(
          `ok: memory already at ${r.dir} · projects[${r.projects.length}]: ${r.projects.join(", ") || "none yet"}`,
          "next: varve add <project> <repo-dir>",
        );
      }
      return out(
        `ok: memory created · ${r.dir}`,
        `files: _company.md, _standards.md, _team/_${r.who}/ · remote: ${r.remote ?? "not set"}`,
        "next: varve add <project> <repo-dir>",
        "help[]: commit and push the store, then keep the default branch protected",
      );
    }

    if (command === "add") {
      if (!arg) fail("missing argument: varve add <project> [dir...]");
      // Everything after the project name is a repo to link. Adding repos to an
      // existing project is the same command again — no separate verb for it.
      const r = await addProject({
        project: arg, title: o.title, team: o.team, repos: positionals.slice(2),
        storePath: memoryPath, who: o.who,
      });
      if (!o["no-skills"] && r.linked.length) await installSkills(agents);
      return out(
        `ok: ${r.project} ${r.created ? "added" : "already present"} · ${r.dir}/${r.project}`,
        `repos[${r.roster.repos.length}]: ${r.roster.repos.join(", ") || "none linked"} · team: ${r.team}`,
        r.linked.length
          ? `next: commit .varve.yml in ${r.linked.map((l) => l.name).join(", ")} — teammates then need nothing`
          : `next: varve add ${r.project} <repo-dir>`,
      );
    }


    fail(`unknown command: ${command} · try: varve --help`, 2);
  } catch (error) {
    fail(error.message);
  }
}

main().catch((error) => fail(error.message));
