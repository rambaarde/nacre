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
import { basename, join } from "node:path";
import { initStore, addProject, status, installSkills } from "../src/operations.js";
import type { Status } from "../src/operations.js";
import { isTTY, s as c, tilde, say, row, head, rule, ok, warn, next, blank } from "../src/render.js";
import { resolveStoreDir, resolveBinding, ensureMemory, memoryNeedsPush, PKG_ROOT } from "../src/store.js";
import { search as searchMemory } from "../src/portal.js";
import { serve } from "../src/serve.js";

// PKG_ROOT is imported, not recomputed. This file had its own copy that counted
// one directory up — correct from bin/ in the repo, wrong from dist/bin/ in the
// package, so `varve --version` failed with ENOENT on every install. store.ts
// had already been fixed to walk up for package.json; the duplicate had not.

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
  --open               open the portal in your browser
  --no-skills          skip installing the skills
  --i-know-its-public  allow a memory anyone can read (it cannot be undone)
  --plain              plain output, as when piped

Reading and writing memory happen through the skills, not this binary.`;

/** Cut at a word boundary and say so, rather than stopping mid-word. */
const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, text.lastIndexOf(" ", max) > max / 2 ? text.lastIndexOf(" ", max) : max)}…`;

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
      row("memory", tilde(st.store)),
      st.reason ? row("", st.reason) : null,
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

  const { binding, repos, logs, here, skillsReady, you } = st;
  const summary = `${repos.length} repo${repos.length === 1 ? "" : "s"} · ${logs.count} log${logs.count === 1 ? "" : "s"}`;
  say(
    ...brand(tilde(st.store)),
    rule(),
    head(binding.project, summary),
    blank(),
    row("repos", repos.map((r) => (r === here ? c.bold(r) : c.dim(r))).join("  ") || c.grey("none linked")),
    logs.newest ? row("last", `${logs.newest.replace(/\.md$/, "")}  ${c.dim(logs.who)}`) : null,
    row("here", here ? c.bold(here) : c.grey("outside a linked repo")),
    row("you", `${c.bold(you)}  ${c.dim("— logs and your profile file under this")}`),
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
  const { binding, repos, logs, here, skillsReady, you } = st;
  out(
    `project: ${binding.project} · repos[${repos.length}]: ${repos.join(", ") || "none linked"} · ` +
      `logs: ${logs.count}${logs.newest ? ` · last: ${logs.newest.replace(/\.md$/, "")} (${logs.who})` : ""}`,
    `memory: ${st.store}${here ? ` · you are in: ${here}` : ""} · you: ${you}`,
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
        row("files", `_company.md  _standards.md  _team/_${r.who}/`),
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
      // "teammates then need nothing" is true of .varve.yml and false of the
      // memory, which no remote has seen yet. Promising the first while the
      // second sits unpushed is how someone clones a wired repo and finds an
      // empty store behind it.
      const needsPush = await memoryNeedsPush(r.dir);
      if (!isTTY()) {
        return out(
          `ok: ${r.project} ${r.created ? "added" : "already present"} · ${r.dir}/${r.project}`,
          `repos[${r.roster.repos.length}]: ${r.roster.repos.join(", ") || "none linked"} · team: ${r.team}`,
          needsPush
            ? `next: commit and push ${r.dir}${fresh.length ? `, then commit .varve.yml in ${fresh.join(", ")}` : ""}`
            : fresh.length
              ? `next: commit .varve.yml in ${fresh.join(", ")} — teammates then need nothing`
              : `next: varve add ${r.project} <repo-dir>`,
          needsPush ? "help[]: until the memory is pushed, a teammate's clone finds nothing behind it" : null,
        );
      }
      return say(blank(),
        ok(`${c.bold(r.project)} ${r.created ? "added" : c.grey("already present")}  ${c.grey(tilde(r.dir + "/" + r.project))}`),
        blank(),
        row("repos", r.roster.repos.map((x) => (fresh.includes(x) ? c.bold(x) : c.dim(x))).join("  ") || c.grey("none linked")),
        row("team", r.team),
        blank(),
        needsPush
          ? next(`commit and push ${c.bold(tilde(r.dir))}${fresh.length ? c.grey(`, then .varve.yml in ${fresh.join(", ")}`) : ""}`)
          : fresh.length
            ? next(`commit ${c.bold(".varve.yml")} in ${fresh.join(", ")} ${c.grey("— teammates then need nothing")}`)
            : next(`varve ${c.bold("add")} ${r.project} <repo-dir>`),
        needsPush ? `  ${c.grey("until the memory is pushed, a teammate's clone finds nothing behind it")}` : null,
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
      // Declared in the options table from the first version and never read, so
      // `--open` silently did nothing. Failing to open is not failing to serve:
      // the URL is printed either way.
      if (o.open) {
        const opener = process.platform === "darwin" ? "open"
          : process.platform === "win32" ? "explorer" : "xdg-open";
        const { spawn } = await import("node:child_process");
        try { spawn(opener, [url], { stdio: "ignore", detached: true }).unref(); } catch { /* the URL is above */ }
      }
      // A developer about to read someone else's reasoning wants to know, in
      // this order: is this the right memory, is it fresh, what is in it, what
      // changed last, and where am I standing. The URL alone answers none of
      // that, and a stale clone reading stale memory is this design's one quiet
      // failure — so its age is stated rather than left to be assumed.
      const { index: readIndex, readLogs: readAll, age: cloneAge } = await import("../src/portal.js");
      const { memoryNeedsPush: needsPush, storeRemote: remoteOf } = await import("../src/store.js");
      const [idx, logs, since, unpushed, remote] = await Promise.all([
        readIndex(memory), readAll(memory), cloneAge(memory), needsPush(memory), remoteOf(memory),
      ]);
      const bind = await resolveBinding();
      const newest = logs[0];
      const named = (m: Record<string, number>, n: number): string =>
        Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
          .map(([k, v]) => `${k} ${c.dim(String(v))}`).join(c.dim("  ·  "));

      if (isTTY()) {
        say(blank(), ok(`portal on ${c.bold(url)}`), blank(),
          row("memory", `${tilde(memory)}  ${c.dim(`pulled ${since}`)}`),
          remote ? row("remote", c.dim(remote)) : null,
          unpushed ? row("", c.yellow("unpushed work here — teammates will not see it yet")) : null,
          blank(),
          row("projects", named(idx.projects, 6) || c.grey("none yet")),
          row("people", named(idx.people, 6) || c.grey("none yet")),
          row("logs", `${idx.total}`),
          newest
            ? row("latest", `${c.dim(newest.date)}  ${newest.who}  ${c.dim(newest.project)}  ${
                clip((newest.summary.split("\n").find((x) => x.trim()) ?? newest.id)
                  .replace(/^#+\s*/, "").replace(/\*\*/g, ""), 58)}`)
            : null,
          blank(),
          bind?.project
            ? row("here", `${basename(process.cwd())} ${c.dim("→")} ${c.bold(bind.project)}`)
            : row("here", c.grey("not inside a wired repo")),
          blank(),
          `  ${c.dim("⌘K")} in the portal to jump  ${c.dim("·")}  ${c.dim("ctrl-c")} to stop`,
          blank());
      } else {
        out(
          `ok: serving ${url}`,
          `memory: ${memory} · pulled ${since}${remote ? ` · remote: ${remote}` : ""}`,
          `projects[${Object.keys(idx.projects).length}]: ${Object.entries(idx.projects).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
          `people[${Object.keys(idx.people).length}]: ${Object.entries(idx.people).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
          `logs: ${idx.total}${newest ? ` · latest: ${newest.date} ${newest.who} ${newest.project}` : ""}`,
          bind?.project ? `here: ${basename(process.cwd())} -> ${bind.project}` : "here: not inside a wired repo",
          unpushed ? "warn: unpushed work in the memory — teammates will not see it yet" : null,
          "help[]: ctrl-c to stop · --open launches your browser",
        );
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
      // Ranking is the engine's; truncation is this adapter's. Breadth beats depth inside a token ceiling. One thorough log can match
      // six times and crowd out every other session that mentioned the same
      // thing — the opposite of what "what did the team decide" needs. The
      // portal still shows every line; this ceiling is the CLI's alone.
      const perLog = new Map<string, number>();
      const spread = hits.filter((h) => {
        const n = (perLog.get(h.id) ?? 0) + 1;
        perLog.set(h.id, n);
        return n <= 2;
      });
      const shown = spread.slice(0, 12);
      out(`hits[${hits.length}]{date,who,project,line}:`,
        ...shown.map((h) => `${h.date},${h.who},${h.project},${h.line.slice(0, 90)}`),
        hits.length > shown.length
          ? `(showing ${shown.length} of ${hits.length}, at most 2 per session — varve serve for all)`
          : null,
        "help[]: varve serve · varve search <term> --all");
      return;
    }

    fail(`unknown command: ${command} · try: varve --help`, 2);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
