/**
 * Tests for reading the memory and serving it.
 *
 * The load-bearing one is that the CLI and the portal rank a query identically.
 * They are different renderers over one search, and if that ever stops being
 * true the promise of one mental model across both doors quietly breaks —
 * silently, because each door on its own would still look correct.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseLog, readLogs, search, projectView, personView, index } from "../src/portal.js";
import { markdown, escape } from "../src/markdown.js";
import { serve } from "../src/serve.js";

const LOG_A = `---
project: atlas
who: alice
started: 2026-08-01T09:14:03
repos: [atlas-api, atlas-web]
---

Renamed the rate-limit headers and verified them in staging.

## Decided against
Raising the shared cache eviction limit. Same instance as beacon.

## Open risks
atlas-web still reads the old header name.

## Next
Remove the old header path in atlas-web.
`;

const LOG_B = `---
project: atlas
who: bob
started: 2026-08-04T16:22:07
repos: [atlas-web]
---

Added the new handler. Deploy after atlas-api.
`;

/** A memory with two people, two projects, and a cross-project fact. */
async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "varve-portal-"));
  // Same isolation as store.test: nothing above the repo may influence a read.
  process.chdir(dir);
  await writeFile(join(dir, "_company.md"), "---\ntype: varve-company\n---\n\nThe cache instance is shared by atlas and beacon.\n");
  await writeFile(join(dir, "_standards.md"), "---\ntype: varve-standards\n---\n\nMigrations are raw SQL.\n");
  const PROJECTS: Array<[string, string]> = [["atlas", "Atlas"], ["beacon", "Beacon"]];
  for (const [p, title] of PROJECTS) {
    await mkdir(join(dir, p), { recursive: true });
    await writeFile(join(dir, p, "_project.md"),
      `---\nproject: ${p}\ntitle: ${title}\nrepos: [${p}-api]\nteams: [devs]\n---\n\n# ${title}\n`);
  }
  await mkdir(join(dir, "atlas", "devs", "alice"), { recursive: true });
  await mkdir(join(dir, "atlas", "devs", "bob"), { recursive: true });
  await mkdir(join(dir, "beacon", "devs", "alice"), { recursive: true });
  await writeFile(join(dir, "atlas/devs/alice/atlas-2026-08-01_09-14-03.md"), LOG_A);
  await writeFile(join(dir, "atlas/devs/bob/atlas-2026-08-04_16-22-07.md"), LOG_B);
  await writeFile(join(dir, "beacon/devs/alice/beacon-2026-07-28_11-02-18.md"),
    "---\nproject: beacon\nwho: alice\nrepos: [beacon-api]\n---\n\nInventory. The cache instance is shared with atlas.\n");
  return dir;
}

test("parseLog splits sections and survives a log that uses none", () => {
  const p = parseLog(LOG_A);
  assert.equal(p.fm.who, "alice");
  assert.deepEqual(p.fm.repos, ["atlas-api", "atlas-web"]);
  assert.match(p.against[0] ?? "", /cache eviction limit/);
  assert.match(p.risks[0] ?? "", /old header name/);
  assert.match(p.next, /Remove the old header path/);

  const plain = parseLog("---\nwho: bob\n---\n\nJust prose, no headings.\n");
  assert.deepEqual(plain.against, [], "no sections is not an error");
  assert.match(plain.summary, /Just prose/, "the body must survive intact");
});

test("readLogs walks team and person folders, newest first", async () => {
  const dir = await fixture();
  const logs = await readLogs(dir);
  assert.equal(logs.length, 3);
  assert.equal(logs[0]?.who, "bob", "newest first, and filenames sort");
  assert.deepEqual(await readLogs(dir, "beacon").then((l) => l.map((x) => x.who)), ["alice"]);
  await rm(dir, { recursive: true, force: true });
});

test("search ranks live constraints above ordinary hits", async () => {
  const dir = await fixture();
  const hits = await search(dir, "cache", { all: true });
  assert.ok(hits.length >= 3);
  assert.equal(hits[0]?.against, true, "a decided-against must not sort below prose");
  assert.ok(hits.some((h) => h.project === "_company"),
    "the company-level fact is the row a per-repo tool cannot produce");
  await rm(dir, { recursive: true, force: true });
});

test("search scoped to one project never returns another's", async () => {
  const dir = await fixture();
  const scoped = await search(dir, "cache", { project: "atlas" });
  assert.ok(scoped.every((h) => h.project === "atlas" || h.project === "_company"));
  assert.ok(!scoped.some((h) => h.project === "beacon"));
  await rm(dir, { recursive: true, force: true });
});

test("a superseding log replaces the one it supersedes", async () => {
  const dir = await fixture();
  await writeFile(join(dir, "atlas/devs/alice/atlas-2026-08-05_10-00-00.md"),
    "---\nproject: atlas\nwho: alice\nsupersedes: atlas-2026-08-01_09-14-03\n---\n\n## Decided against\nCorrected: the limit can be raised after beacon moves off.\n");
  const v = await projectView(dir, "atlas");
  assert.ok(v);
  assert.ok(!v.logs.some((l) => l.id === "atlas-2026-08-01_09-14-03"),
    "the superseded log drops out of the live view");
  assert.ok(v.logs.some((l) => l.against.some((a) => /Corrected/.test(a))),
    "and the superseding one carries the correction");
  assert.equal(v.count, 3, "but both files remain — nothing is overwritten");
  await rm(dir, { recursive: true, force: true });
});

test("projectView orders by urgency of not knowing", async () => {
  const dir = await fixture();
  const v = await projectView(dir, "atlas");
  assert.ok(v);
  assert.ok(v);
  assert.match(v.handoff, /Remove the old header path/);
  assert.deepEqual(v.repos, ["atlas-api"]);
  // Decisions and rejections are read in the log that made them, not merged
  // onto this page — a project with 99 logs would otherwise render 92 of them.
  assert.ok(!("against" in v), "the project page must not aggregate log content");
  assert.ok(!("risks" in v));
  await rm(dir, { recursive: true, force: true });
});

test("personView spans projects", async () => {
  const dir = await fixture();
  const v = await personView(dir, "alice");
  assert.deepEqual(v.projects, ["atlas", "beacon"]);
  assert.equal(v.count, 2);
  assert.ok(!("against" in v), "nor the person page");
  assert.ok(!("decisions" in v));
  await rm(dir, { recursive: true, force: true });
});

test("index counts all three axes", async () => {
  const dir = await fixture();
  const i = await index(dir);
  assert.deepEqual(i.projects, { atlas: 2, beacon: 1 });
  assert.deepEqual(i.people, { alice: 2, bob: 1 });
  assert.equal(i.total, 3);
  await rm(dir, { recursive: true, force: true });
});

test("markdown escapes anything that could inject", () => {
  const html = markdown('<script>alert(1)</script>\n\n**bold** and `code`');
  assert.ok(!html.includes("<script>"), "raw tags must never survive");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.equal(escape('a "b" <c>'), "a &quot;b&quot; &lt;c&gt;");
});

test("the portal serves every axis", async () => {
  const dir = await fixture();
  const { server, url } = await serve({ memory: dir, port: 0 });
  const get = async (p: string) => {
    const res = await fetch(url + p);
    return { status: res.status, body: await res.text() };
  };
  try {
    const project = await get("/p/atlas");
    assert.equal(project.status, 200);
    assert.match(project.body, /Remove the old header path/);
    assert.ok(!/text-decoration:\s*line-through/.test(project.body),
      "a live constraint must never render as struck through");

    assert.match((await get("/who/alice")).body, /projects\[2\]/);
    assert.match((await get("/t/2026-08")).body, /2026-08/);
    assert.match((await get("/search?q=cache&all=1")).body, /hit/);
    assert.equal((await get("/p/nope")).status, 404);
    assert.equal((await get("/nowhere")).status, 404);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the CLI and the portal rank a query identically", async () => {
  // One search(), two renderers. If these ever diverge, each door still looks
  // right on its own — which is exactly why it needs a test rather than a rule.
  const dir = await fixture();
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const bin = new URL("../bin/varve.js", import.meta.url).pathname;

  const engine = await search(dir, "cache", { all: true });
  const { stdout } = await run(process.execPath,
    [bin, "search", "cache", "--all", "--memory", dir]);

  const cliOrder = stdout.split("\n").filter((l: string) => /^\d{4}-|^,/.test(l))
    .map((l: string) => l.split(",").slice(0, 3).join(","));
  const engineOrder = engine.slice(0, cliOrder.length)
    .map((h) => [h.date, h.who, h.repo].join(","));
  assert.deepEqual(cliOrder, engineOrder, "ranking is the engine's job, truncation the adapter's");
  await rm(dir, { recursive: true, force: true });
});

test("company-wide reads sort by time, not by project name", async () => {
  // Filenames begin with the project slug, so sorting by name orders a
  // company-wide read alphabetically by project — and looks perfectly correct
  // inside any single project, which is why it needs its own test.
  const dir = await fixture();
  const logs = await readLogs(dir);
  const stamps = logs.map((l) => l.stamp);
  assert.deepEqual([...stamps].sort().reverse(), stamps, "newest first, across every project");
  assert.equal(logs[0]?.who, "bob");
  await rm(dir, { recursive: true, force: true });
});

test("varve search and varve serve work as commands, not just as functions", async () => {
  // Everything else exercises the operations directly. These two reach the user
  // only through the CLI, so the wiring between them needs its own check.
  const dir = await fixture();
  const { execFile, spawn } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const bin = new URL("../bin/varve.js", import.meta.url).pathname;

  const { stdout } = await run(process.execPath, [bin, "search", "cache", "--all", "--memory", dir]);
  assert.match(stdout, /^hits\[\d+\]\{date,who,repo,line\}:/m, "AXI shape on stdout");
  assert.match(stdout, /help\[\]:/, "every result ends in a next step");

  const empty = await run(process.execPath, [bin, "search", "zzzznothing", "--all", "--memory", dir]);
  assert.match(empty.stdout, /no hits/, "an empty result must be explicit, never silent");

  // serve holds the process open, so drive it as a child and stop it.
  const child = spawn(process.execPath, [bin, "serve", "--memory", dir, "--port", "0"]);
  try {
    const line: string = await new Promise<string>((resolve, reject) => {
      child.stdout.once("data", (d: unknown) => resolve(String(d)));
      child.once("error", reject);
      setTimeout(() => reject(new Error("serve did not announce a url")), 8000);
    });
    assert.match(line, /ok: serving http:\/\/127\.0\.0\.1:\d+/);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("--port 0 asks for any free port, and is not swallowed", async () => {
  // `|| 4173` treated an explicit 0 as absent. Port 0 is the conventional way
  // to ask the OS for a free port, and it is what a second instance needs.
  const dir = await fixture();
  const { spawn } = await import("node:child_process");
  const bin = new URL("../bin/varve.js", import.meta.url).pathname;
  const child = spawn(process.execPath, [bin, "serve", "--memory", dir, "--port", "0"]);
  try {
    const line: string = await new Promise<string>((resolve, reject) => {
      child.stdout.once("data", (d: unknown) => resolve(String(d)));
      setTimeout(() => reject(new Error("no url")), 8000);
    });
    const port = Number(line.match(/:(\d+)/)?.[1]);
    assert.notEqual(port, 4173, "an explicit 0 must not fall back to the default");
    assert.ok(port > 0);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the vault's own bullet format parses, not just headings", async () => {
  // The format this design descends from uses labelled bullets under one
  // heading, not `## Sections`. A heading-only parser read a real 103-day-old
  // vault and surfaced nothing — every block on the project page came up empty
  // while the file rendered fine, which is the worst shape of wrong.
  const log = [
    "---", "project: acme", "who: ram", "---", "",
    "# Session Outcome", "",
    "* **High-Level Summary:** Split 401 and 419 so the client can tell",
    "  expired from unauthorised.",
    "* **Important Decisions:** API ships first; the web app follows.",
    "* **Decided Against:** Raising the shared eviction limit.",
    "* **Constraints / Blockers:** acme-fe still treats 419 as a logout.",
    "* **Next Step:** Add the handler, then deploy fe after be.",
    "* **Notes for Future AI:** Deploy order is a contract.",
  ].join("\n");

  const p = parseLog(log);
  assert.match(p.summary, /Split 401 and 419/);
  assert.match(p.decisions[0] ?? "", /API ships first/);
  assert.match(p.against[0] ?? "", /Raising the shared eviction limit/);
  assert.match(p.risks[0] ?? "", /still treats 419/, "Constraints / Blockers must reach risks");
  assert.match(p.next, /deploy fe after be/);
  assert.match(p.notes[0] ?? "", /contract/);

  // A wrapped bullet is one thought, not two entries.
  assert.ok(!p.summary.includes("\n"), "wrapped lines fold into one entry");
  assert.match(p.summary, /tell expired from unauthorised/);
});

test("heading form still parses, so either shape works", () => {
  const p = parseLog("---\nwho: jun\n---\n\n## Decided against\nOptimistic UI.\n\n## Next\nShip it.\n");
  assert.match(p.against[0] ?? "", /Optimistic UI/);
  assert.match(p.next, /Ship it/);
});

test("a project can carry its own standards, and they stay scoped to it", async () => {
  // Company standards are paid for by every project on every read. A rule true
  // of one stack must not be one of them — a Python project should never load
  // a Node project's test runner.
  const dir = await fixture();
  await writeFile(join(dir, "atlas", "_standards.md"),
    "---\ntype: varve-project-standards\nproject: atlas\n---\n\n# Atlas — Standards\n\n* **Stack:** Node 20, Postgres.\n");

  const { projectStandards, projectView } = await import("../src/portal.js");

  assert.match((await projectStandards(dir, "atlas")) ?? "", /Node 20/);
  assert.equal(await projectStandards(dir, "beacon"), null,
    "a project without its own standards must report none, not inherit a file");

  assert.equal((await projectView(dir, "atlas"))?.hasStandards, true);
  assert.equal((await projectView(dir, "beacon"))?.hasStandards, false);

  const { serve } = await import("../src/serve.js");
  const { server, url } = await serve({ memory: dir, port: 0 });
  try {
    const atlas = await fetch(`${url}/s/atlas`);
    assert.equal(atlas.status, 200);
    assert.match(await atlas.text(), /Node 20/);

    // Absent is not an error worth a stack trace — it means the company rules apply.
    const beacon = await fetch(`${url}/s/beacon`);
    assert.equal(beacon.status, 404);
    assert.match(await beacon.text(), /company standards apply/);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the project page carries the curated note and does not grow with the log", async () => {
  // The page used to assemble every decision and rejection from every log. At
  // the scale the source vault actually runs — 99 logs, 92 of them carrying
  // decisions — that is a wall, and capping it only made it a truncated wall.
  const dir = await fixture();
  const many = join(dir, "atlas", "devs", "alice");
  for (let i = 1; i <= 40; i++) {
    const day = String(10 + (i % 20)).padStart(2, "0");
    await writeFile(join(many, `atlas-2026-09-${day}_09-${String(i).padStart(2, "0")}-00.md`),
      `---\nproject: atlas\nwho: alice\n---\n\n* **Decided Against:** rejection ${i}.\n`);
  }

  const { serve } = await import("../src/serve.js");
  const { server, url } = await serve({ memory: dir, port: 0 });
  try {
    const body = await (await fetch(`${url}/p/atlas`)).text();
    assert.match(body, /Project note/, "the curated half is what the page carries");
    assert.doesNotMatch(body, /rejection 4\b/, "log content is not merged onto the page");
    assert.doesNotMatch(body, /Decided against<\/span>/i);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the rail is identical on every page — only the highlight moves", async () => {
  // A sidebar that changes shape as you move is not navigation. The project
  // group used to appear only on project pages, so clicking a person made the
  // whole rail jump up four rows and every target land somewhere else.
  const dir = await fixture();
  await writeFile(join(dir, "atlas", "_standards.md"),
    "---\nproject: atlas\n---\n\n# Atlas — Standards\n\n* **Stack:** Node.\n");

  const { serve } = await import("../src/serve.js");
  const { server, url } = await serve({ memory: dir, port: 0 });
  try {
    const railOf = async (path: string) => {
      const html = await (await fetch(url + path)).text();
      const rail = html.match(/<nav class="rail">[\s\S]*?<\/nav>/)?.[0] ?? "";
      // The active-highlight class is the only thing allowed to differ.
      return rail.replace(/class="(on)?"/g, "").replace(/\s+/g, " ");
    };

    const paths = ["/p/atlas", "/s/atlas", "/who/alice", "/c/_company", "/t/2026-08", "/search?q=cache"];
    const rails = await Promise.all(paths.map(railOf));
    for (const [i, rail] of rails.entries()) {
      assert.equal(rail, rails[0], `${paths[i]} renders a different rail`);
    }
    assert.ok(rails[0]!.length > 0, "and it is not empty");

    // Project-scoped nav lives on the page, where it cannot reflow the sidebar.
    const overview = await (await fetch(`${url}/p/atlas`)).text();
    assert.match(overview, /<nav class="tabs">/);
    assert.match(overview, /href="\/s\/atlas"/);

    // A page load must not log a 404 for a missing favicon.
    assert.equal((await fetch(`${url}/favicon.ico`)).status, 204);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the auto block never stands in for what a person wrote", async () => {
  // git output appended below the notes must not become the summary. A log with
  // commits and nothing said is still a log with nothing said.
  const log = [
    "---", "project: atlas", "who: ram", "---", "",
    "# Session Outcome", "",
    "* **High-Level Summary:** Split 401 and 419.",
    "", "## Auto Session Log",
    "_Auto-generated 2026-08-04 22:36:21._", "",
    "* **Repos:** atlas-api", "* **Branch:** main",
    "* **Commits this session:**", "- b057180 feat(api): send 419 on expiry",
  ].join("\n");

  const p = parseLog(log);
  assert.match(p.summary, /Split 401 and 419/);
  assert.doesNotMatch(p.summary, /b057180|Auto Session Log/,
    "machine output must stay out of the human summary");
  assert.ok(p.auto.some((a) => /b057180/.test(a)), "but it is still captured and readable");
});
