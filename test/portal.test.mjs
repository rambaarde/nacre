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

import { parseLog, readLogs, search, projectView, personView, index } from "../src/portal.mjs";
import { markdown, escape } from "../src/markdown.mjs";
import { serve } from "../src/serve.mjs";

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
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "varve-portal-"));
  await writeFile(join(dir, "_company.md"), "---\ntype: varve-company\n---\n\nThe cache instance is shared by atlas and beacon.\n");
  await writeFile(join(dir, "_standards.md"), "---\ntype: varve-standards\n---\n\nMigrations are raw SQL.\n");
  for (const [p, title] of [["atlas", "Atlas"], ["beacon", "Beacon"]]) {
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
  assert.match(p.against[0], /cache eviction limit/);
  assert.match(p.risks[0], /old header name/);
  assert.match(p.next, /Remove the old header path/);

  const plain = parseLog("---\nwho: bob\n---\n\nJust prose, no headings.\n");
  assert.deepEqual(plain.against, [], "no sections is not an error");
  assert.match(plain.summary, /Just prose/, "the body must survive intact");
});

test("readLogs walks team and person folders, newest first", async () => {
  const dir = await fixture();
  const logs = await readLogs(dir);
  assert.equal(logs.length, 3);
  assert.equal(logs[0].who, "bob", "newest first, and filenames sort");
  assert.deepEqual(await readLogs(dir, "beacon").then((l) => l.map((x) => x.who)), ["alice"]);
  await rm(dir, { recursive: true, force: true });
});

test("search ranks live constraints above ordinary hits", async () => {
  const dir = await fixture();
  const hits = await search(dir, "cache", { all: true });
  assert.ok(hits.length >= 3);
  assert.equal(hits[0].against, true, "a decided-against must not sort below prose");
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
  assert.ok(!v.against.some((a) => /Same instance as beacon\./.test(a.what)),
    "the superseded entry drops out of the live view");
  assert.ok(v.against.some((a) => /Corrected/.test(a.what)));
  assert.equal(v.count, 3, "but both files remain — nothing is overwritten");
  await rm(dir, { recursive: true, force: true });
});

test("projectView orders by urgency of not knowing", async () => {
  const dir = await fixture();
  const v = await projectView(dir, "atlas");
  assert.match(v.handoff, /Remove the old header path/);
  assert.equal(v.against.length, 1);
  assert.equal(v.risks.length, 1);
  assert.deepEqual(v.repos, ["atlas-api"]);
  await rm(dir, { recursive: true, force: true });
});

test("personView spans projects", async () => {
  const dir = await fixture();
  const v = await personView(dir, "alice");
  assert.deepEqual(v.projects, ["atlas", "beacon"]);
  assert.equal(v.count, 2);
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
  const get = async (p) => {
    const res = await fetch(url + p);
    return { status: res.status, body: await res.text() };
  };
  try {
    const project = await get("/p/atlas");
    assert.equal(project.status, 200);
    assert.match(project.body, /Decided against/);
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
  const bin = new URL("../bin/varve.mjs", import.meta.url).pathname;

  const engine = await search(dir, "cache", { all: true });
  const { stdout } = await run(process.execPath,
    [bin, "search", "cache", "--all", "--memory", dir]);

  const cliOrder = stdout.split("\n").filter((l) => /^\d{4}-|^,/.test(l))
    .map((l) => l.split(",").slice(0, 3).join(","));
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
  assert.equal(logs[0].who, "bob");
  await rm(dir, { recursive: true, force: true });
});
