#!/usr/bin/env node
/**
 * varve CLI — argv in, one operation, rendered result out.
 *
 * No product logic here by design; it all lives in src/operations.ts.
 *
 * Output follows AXI (https://axi.md/): structured lines on stdout, explicit
 * empty states, and every command ending in the next command to run — so nobody
 * has to memorise a sequence. Exit 0 success / 1 error / 2 unknown flag.
 */

import { parseArgs } from "node:util";
import type { ParseArgsOptionsConfig } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initStore, addProject, status, installSkills } from "../src/operations.js";
import type { Status } from "../src/operations.js";
import { isTTY, s as c, tilde, say, row, head, rule, ok, warn, next, blank } from "../src/render.js";
import { resolveStoreDir, resolveBinding, ensureMemory } from "../src/store.js";
import { search as searchMemory } from "../src/portal.js";
import { serve } from "../src/serve.js";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const OPTIONS = {
  memory: { type: "string" },
  "memory-path": { type: "string" }, // accepted spellings
  "store-path": { type: "string" },
  title: { type: "string" },
  team: { type: "string" },
  who: { type: "string" },
  agents: { type: "string" },
  force: { type: "boolean" },
  "no-skills": { type: "boolean" },
  "i-know-its-public": { type: "boolean" },
  plain: { type: "boolean" },
  port: { type: "string" },
  all: { type: "boolean" },
  open: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
} as const satisfies ParseArgsOptionsConfig;

const USAGE = `varve — one git-backed memory for a whole company

  varve                          where am I, and what is next
  varve init <git-url>           create the company memory     (once)
  varve add  <project> [dir...]  add a project, and its repos  (as needed)
  varve serve                    the portal, from your own clone
  varve search <term>            one search, same ranking as the portal

  also works as \`vrv\`

Adding repos to an existing project is the same command again:
  varve add atlas ../atlas-worker

  --memory <name|dir>  which memory, when you have more than one
  --team <name>        team folder       (default: devs)
  --title <name>       display name
  --who <slug>         author slug       (default: from git config)
  --agents <a,b>       claude,opencode   (default: claude)
  --all                search every project, not just this one
  --port <n>           portal port       (default: 4173)
  --no-skills          skip installing the skills
  --i-know-its-public  allow a memory anyone can read (it cannot be undone)
  --plain              plain output, as when piped

Reading and writing memory happen through the skills, not this binary.`;

const out = (...lines: (string | null | undefined)[]): void =>
  lines.filter(Boolean).forEach((l) => console.log(l));

/** Brand line. Only a person needs to be told what they are looking at. */
const brand = (right: string): string[] => (isTTY() ? [blank(), head("varve", right)] : []);

function fail(message: string, code = 1): never {
  if (isTTY()) {
    say(blank(), `  ${c.red("✗")} ${tilde(message)}`, blank());
  } else {
    console.log(`error: ${message}`);
    console.log("help[]: varve --help");
  }
  process.exit(code);
}

/** Bare `varve` — live state, and the single next command that applies. */
function renderStatus(st: Status): void {
  if (!isTTY()) return renderStatusPlain(st);

  if (st.state === "no-store") {
    return say(...brand(""), rule(),
      row("memory", c.grey(tilde(st.store))),
      st.reason ? row("", c.grey(st.reason)) : null,
      blank(), next(`varve ${c.bold("init")} <git-url>`), blank());
  }
  if (st.state === "no-binding") {
    const list = st.projects.length ? st.projects.join("  ") : c.grey("none yet");
    return say(...brand(tilde(st.store)), rule(),
      row("projects", list),
      row("here", c.grey("not bound to a project")),
      blank(),
      next(st.projects.length
        ? `varve ${c.bold("add")} <${st.projects.join("|")}> .`
        : `varve ${c.bold("add")} <project> .`),
      blank());
  }
  if (st.state === "unknown-project") {
    return say(...brand(tilde(st.store)), rule(),
      warn(`.varve.yml names ${c.bold(st.binding.project)}, which is not in this memory`),
      row("projects", st.projects.join("  ") || c.grey("none")),
      blank(), next(`varve ${c.bold("add")} ${st.binding.project}`), blank());
  }

  const { binding, repos, logs, here, skillsReady } = st;
  const summary = `${repos.length} repo${repos.length === 1 ? "" : "s"} · ${logs.count} log${logs.count === 1 ? "" : "s"}`;
  say(
    ...brand(tilde(st.store)),
    rule(),
    head(binding.project, summary),
    blank(),
    row("repos", repos.map((r) => (r === here ? c.bold(r) : c.grey(r))).join("  ") || c.grey("none linked")),
    logs.newest ? row("last", `${logs.newest.replace(/\.md$/, "")}  ${c.grey(logs.who)}`) : null,
    row("here", here ? c.bold(here) : c.grey("outside a linked repo")),
    blank(),
    skillsReady ? null : warn(`skills not installed · varve add ${binding.project} .`),
    logs.count === 0
      ? next(`${c.bold("varve-publish")} at the end of this session ${c.grey("— nothing recorded yet")}`)
      : next(`${c.bold("varve-load")} at session start · ${c.bold("varve-publish")} at the end`),
    blank(),
  );
}

/** The plain path is byte-for-byte what agents and CI already parse. */
function renderStatusPlain(st: Status): void {
  if (st.state === "no-store") {
    return out(
      `no memory at ${st.store}`,
      st.reason ? `reason: ${st.reason}` : null,
      "next: varve init <git-url>",
      "help[]: varve --help",
    );
  }
  if (st.state === "no-binding") {
    return out(
      `memory: ${st.store} · projects[${st.projects.length}]: ${st.projects.join(", ") || "none yet"}`,
      "this directory is not bound to a project",
      st.projects.length ? `next: varve add <${st.projects.join("|")}> .` : "next: varve add <project> .",
      "help[]: varve --help",
    );
  }
  if (st.state === "unknown-project") {
    return out(
      `error: .varve.yml names "${st.binding.project}", which is not in ${st.store}`,
      `projects[${st.projects.length}]: ${st.projects.join(", ") || "none"}`,
      `next: varve add ${st.binding.project}`,
    );
  }
  const { binding, repos, logs, here, skillsReady } = st;
  out(
    `project: ${binding.project} · repos[${repos.length}]: ${repos.join(", ") || "none linked"} · ` +
      `logs: ${logs.count}${logs.newest ? ` · last: ${logs.newest.replace(/\.md$/, "")} (${logs.who})` : ""}`,
    `memory: ${st.store}${here ? ` · you are in: ${here}` : ""}`,
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
    fail(error instanceof Error ? error.message : String(error), 2);
  }
  const { values: o, positionals } = parsed;
  const [command, arg] = positionals;

  if (o.version) {
    const pkg = JSON.parse(await readFile(join(PKG_ROOT, "package.json"), "utf8"));
    return console.log(pkg.version);
  }
  if (o.help || command === "help") return console.log(USAGE);

  const memoryPath = o.memory ?? o["memory-path"] ?? o["store-path"];
  const agents = (o.agents ?? "claude").split(",").map((a) => a.trim()).filter(Boolean);

  try {
    // Bare `varve` shows live state, never a usage dump.
    if (!command) return renderStatus(await status({ storePath: memoryPath }));

    if (command === "init") {
      if (!arg && !memoryPath) fail("missing argument: varve init <git-url>");
      const r = await initStore({
        store: arg, storePath: memoryPath, who: o.who, force: o.force,
        allowPublic: o["i-know-its-public"],
      });
      // Cloned, not created — the company already had a memory at this URL, and
      // saying "created" would describe the one thing that did not happen.
      const cloned = "cloned" in r && r.cloned;
      if (!isTTY()) {
        if (cloned) {
          return out(
            `ok: memory fetched · ${r.dir}`,
            `projects[${r.projects.length}]: ${r.projects.join(", ") || "none yet"} · remote: ${r.remote ?? "not set"}`,
            "next: varve add <project> <repo-dir>",
            "help[]: this memory already existed — nothing was overwritten",
          );
        }
        return r.created
          ? out(
              `ok: memory created · ${r.dir}`,
              `files: _company.md, _standards.md, _team/_${r.who}/ · remote: ${r.remote ?? "not set"}`,
              "next: varve add <project> <repo-dir>",
              "help[]: commit and push the memory, then keep the default branch protected",
            )
          : out(
              `ok: memory already at ${r.dir} · projects[${r.projects.length}]: ${r.projects.join(", ") || "none yet"}`,
              "next: varve add <project> <repo-dir>",
            );
      }
      if (cloned) {
        return say(blank(), ok(`memory fetched  ${c.grey(tilde(r.dir))}`),
          blank(),
          row("projects", r.projects.join("  ") || c.grey("none yet")),
          row("remote", r.remote ?? c.grey("not set")),
          blank(),
          `  ${c.grey("this memory already existed — nothing was overwritten")}`,
          next(`varve ${c.bold("add")} <project> <repo-dir>`), blank());
      }
      if (!r.created) {
        return say(blank(), ok(`memory already at ${c.bold(tilde(r.dir))}`),
          row("projects", r.projects.join("  ") || c.grey("none yet")),
          blank(), next(`varve ${c.bold("add")} <project> <repo-dir>`), blank());
      }
      return say(blank(),
        ok(`memory created  ${c.grey(tilde(r.dir))}`),
        blank(),
        row("files", c.grey(`_company.md  _standards.md  _team/_${r.who}/`)),
        row("remote", r.remote ?? c.grey("not set")),
        blank(),
        next(`varve ${c.bold("add")} <project> <repo-dir>`),
        `  ${c.grey("then commit and push it, and protect the default branch")}`,
        blank());
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
      const fresh = r.linked.filter((l) => l.wrote).map((l) => l.name);
      if (!isTTY()) {
        return out(
          `ok: ${r.project} ${r.created ? "added" : "already present"} · ${r.dir}/${r.project}`,
          `repos[${r.roster.repos.length}]: ${r.roster.repos.join(", ") || "none linked"} · team: ${r.team}`,
          fresh.length
            ? `next: commit .varve.yml in ${fresh.join(", ")} — teammates then need nothing`
            : `next: varve add ${r.project} <repo-dir>`,
        );
      }
      return say(blank(),
        ok(`${c.bold(r.project)} ${r.created ? "added" : c.grey("already present")}  ${c.grey(tilde(r.dir + "/" + r.project))}`),
        blank(),
        row("repos", r.roster.repos.map((x) => (fresh.includes(x) ? c.bold(x) : c.grey(x))).join("  ") || c.grey("none linked")),
        row("team", c.grey(r.team)),
        blank(),
        fresh.length
          ? next(`commit ${c.bold(".varve.yml")} in ${fresh.join(", ")} ${c.grey("— teammates then need nothing")}`)
          : next(`varve ${c.bold("add")} ${r.project} <repo-dir>`),
        blank());
    }


    if (command === "serve") {
      const binding = await resolveBinding();
      const memory = await resolveStoreDir(memoryPath, binding?.store);
      const ready = await ensureMemory(memory, binding?.store);
      if (!ready.ok) fail(`${tilde(memory)} · ${ready.reason}`);
      const port = o.port === undefined ? 4173 : Number(o.port);
      if (Number.isNaN(port)) fail(`--port must be a number, got: ${o.port}`, 2);
      const { url } = await serve({ memory, port });
      if (isTTY()) {
        say(blank(), ok(`portal on ${c.bold(url)}`),
          row("memory", c.grey(tilde(memory))),
          blank(), `  ${c.grey("read-only · loopback only · ctrl-c to stop")}`, blank());
      } else {
        out(`ok: serving ${url}`, `memory: ${memory}`, "help[]: ctrl-c to stop");
      }
      return new Promise(() => {}); // hold the process open
    }

    if (command === "search") {
      const term = positionals.slice(1).join(" ");
      if (!term) fail("missing argument: varve search <term>");
      const binding = await resolveBinding();
      const memory = await resolveStoreDir(memoryPath, binding?.store);
      await ensureMemory(memory, binding?.store);
      const hits = await searchMemory(memory, term, { project: binding?.project, all: o.all });
      if (!hits.length) {
        return out(`no hits for "${term}"${binding?.project && !o.all ? ` in ${binding.project}` : ""}`,
          "help[]: varve search <term> --all");
      }
      // Ranking is the engine's; truncation is this adapter's. The portal shows
      // every hit, the CLI cuts to its ceiling — same order either way.
      const shown = hits.slice(0, 12);
      out(`hits[${hits.length}]{date,who,repo,line}:`,
        ...shown.map((h) => `${h.date},${h.who},${h.repo},${h.line.slice(0, 90)}`),
        hits.length > shown.length ? `(truncated, ${hits.length} total — use varve serve)` : null,
        "help[]: varve serve · varve search <term> --all");
      return;
    }

    fail(`unknown command: ${command} · try: varve --help`, 2);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
