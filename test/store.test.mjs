/**
 * Tests for store access and the three setup operations.
 *
 * Weighted toward the two bugs that shipped and had to be found by hand:
 * frontmatter that would not parse behind a leading comment, and a roster merge
 * that erased the repo it was supposed to be adding to. Both were invisible in
 * review and obvious the moment the thing was run, so they get regression tests
 * before anything else does.
 *
 * node:test only — the zero-dependency rule applies to the toolchain too.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  frontmatter, setFrontmatterKey, repoName, resolveBinding,
  readRoster, addToRoster, listProjects, logStats, discoverStores,
} from "../src/store.mjs";
import { initStore, addProject, linkRepo, status } from "../src/operations.mjs";

/** Run a body with HOME pointed at a fresh directory, then clean up. */
async function withHome(body) {
  const home = await mkdtemp(join(tmpdir(), "varve-test-"));
  const realHome = process.env.HOME;
  const realStore = process.env.VARVE_STORE;
  const cwd = process.cwd();
  process.env.HOME = home;
  delete process.env.VARVE_STORE;
  try {
    return await body(home);
  } finally {
    process.chdir(cwd);
    process.env.HOME = realHome;
    if (realStore) process.env.VARVE_STORE = realStore;
    await rm(home, { recursive: true, force: true });
  }
}

test("frontmatter parses a plain block", () => {
  const fm = frontmatter("---\nproject: atlas\nrepos: [a, b]\n---\nbody");
  assert.equal(fm.project, "atlas");
  assert.deepEqual(fm.repos, ["a", "b"]);
});

test("frontmatter survives a leading comment — the roster-erasure bug", () => {
  // Every template used to open with an HTML comment, so `^---` never matched,
  // every roster read returned empty, and linking a second repo wiped the first.
  const fm = frontmatter("<!-- why this file exists -->\n---\nproject: atlas\nrepos: [a]\n---\n");
  assert.equal(fm.project, "atlas", "a leading comment must not blank the block");
  assert.deepEqual(fm.repos, ["a"]);
});

test("frontmatter strips trailing comments from values", () => {
  assert.equal(frontmatter("---\nproject: atlas   # immutable\n---").project, "atlas");
});

test("frontmatter returns empty rather than throwing on junk", () => {
  assert.deepEqual(frontmatter("no frontmatter here"), {});
});

test("setFrontmatterKey replaces in place and leaves the rest verbatim", () => {
  const before = "---\nproject: atlas\nrepos: [a]\n---\n# Body\n\nkeep me\n";
  const after = setFrontmatterKey(before, "repos", ["a", "b"]);
  assert.match(after, /^repos: \[a, b\]$/m);
  assert.match(after, /keep me/);
  assert.match(after, /^project: atlas$/m);
});

test("repoName derives the store directory from any git URL form", () => {
  assert.equal(repoName("git@github.com:acme/acme-context.git"), "acme-context");
  assert.equal(repoName("https://github.com/atlas/atlas-context.git"), "atlas-context");
  assert.equal(repoName("git@gitlab.com:foo/bar-memory"), "bar-memory");
  assert.equal(repoName(undefined), null);
});

test("resolveBinding walks up, and returns null rather than guessing", async () => {
  await withHome(async (home) => {
    const deep = join(home, "repo", "src", "nested");
    await mkdir(deep, { recursive: true });
    assert.equal(await resolveBinding(deep), null, "no binding must not be a guess");

    await writeFile(join(home, "repo", ".varve.yml"), "project: atlas\nstore: git@h:a/s.git\n");
    const found = await resolveBinding(deep);
    assert.equal(found.project, "atlas");
    assert.equal(found.store, "git@h:a/s.git");
  });
});

test("init → add wires both records", async () => {
  await withHome(async (home) => {
    const repo = join(home, "atlas-web");
    await mkdir(repo, { recursive: true });

    const store = await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    assert.ok(store.created);
    assert.equal(store.dir, join(home, "acme-context"), "memory path comes from the repo name");

    await addProject({ project: "atlas", title: "Atlas", who: "alice" });
    assert.deepEqual(await listProjects(store.dir), ["atlas"]);

    const linked = await linkRepo({ repo, project: "atlas" });
    assert.ok(linked.wrote);

    // Record one: the repo's own binding.
    const binding = await readFile(join(repo, ".varve.yml"), "utf8");
    assert.match(binding, /project: atlas/);
    assert.match(binding, /memory: git@github\.com:acme\/acme-context\.git/);

    // Record two: the project roster. Updating only one would leave the
    // company-level answer silently wrong.
    assert.deepEqual((await readRoster(store.dir, "atlas")).repos, ["atlas-web"]);
  });
});

test("linking a second repo keeps the first — the erasure regression", async () => {
  await withHome(async (home) => {
    for (const name of ["atlas-web", "atlas-api"]) await mkdir(join(home, name), { recursive: true });
    const store = await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    await addProject({ project: "atlas", who: "alice" });

    await linkRepo({ repo: join(home, "atlas-web"), project: "atlas" });
    await linkRepo({ repo: join(home, "atlas-api"), project: "atlas" });

    assert.deepEqual(
      (await readRoster(store.dir, "atlas")).repos,
      ["atlas-api", "atlas-web"],
      "a roster merge must be a union, never a replacement",
    );
  });
});

test("linking the second repo needs no URL; it resolves", async () => {
  await withHome(async (home) => {
    await mkdir(join(home, "atlas-api"), { recursive: true });
    await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    await addProject({ project: "atlas", who: "alice" });
    const linked = await linkRepo({ repo: join(home, "atlas-api"), project: "atlas" });
    assert.equal(linked.store, "git@github.com:acme/acme-context.git");
  });
});

test("rebinding a repo to a different project is refused", async () => {
  await withHome(async (home) => {
    const repo = join(home, "atlas-web");
    await mkdir(repo, { recursive: true });
    await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    await addProject({ project: "atlas", who: "alice" });
    await addProject({ project: "beacon", who: "alice" });
    await linkRepo({ repo, project: "atlas" });

    await assert.rejects(
      () => linkRepo({ repo, project: "beacon" }),
      /already binds this repo to "atlas"/,
      "silently re-pointing a repo at other memory is the failure nobody notices",
    );
    assert.match(await readFile(join(repo, ".varve.yml"), "utf8"), /project: atlas/);
  });
});

test("two companies on one machine get separate memories", async () => {
  await withHome(async (home) => {
    const a = await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    const b = await initStore({ store: "git@github.com:beta/beta-memory.git", who: "alice" });
    assert.equal(a.dir, join(home, "acme-context"));
    assert.equal(b.dir, join(home, "beta-memory"));
    assert.deepEqual((await discoverStores()).sort(), [a.dir, b.dir].sort());
  });
});

test("an ambiguous memory is reported, never picked", async () => {
  await withHome(async (home) => {
    await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    await initStore({ store: "git@github.com:beta/beta-memory.git", who: "alice" });
    const unbound = join(home, "elsewhere");
    await mkdir(unbound, { recursive: true });
    process.chdir(unbound);
    await assert.rejects(() => status(), /several memories found/);
  });
});

test("status reports each stage without a store or binding", async () => {
  await withHome(async (home) => {
    const loose = join(home, "loose");
    await mkdir(loose, { recursive: true });
    process.chdir(loose);
    assert.equal((await status()).state, "no-store");

    await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    assert.equal((await status()).state, "no-binding");

    await addProject({ project: "atlas", who: "alice" });
    await linkRepo({ repo: loose, project: "atlas" });
    const ready = await status();
    assert.equal(ready.state, "ready");
    assert.equal(ready.binding.project, "atlas");
    assert.equal(ready.logs.count, 0, "a fresh project has an explicit empty state");
  });
});

test("logStats counts sessions across teams and people", async () => {
  await withHome(async (home) => {
    const store = await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    await addProject({ project: "atlas", who: "alice" });
    const dir = join(store.dir, "atlas");
    await mkdir(join(dir, "devs", "bob"), { recursive: true });
    await writeFile(join(dir, "devs", "alice", "atlas-2026-08-01_09-00-00.md"), "x");
    await writeFile(join(dir, "devs", "bob", "atlas-2026-08-04_16-00-00.md"), "x");

    const stats = await logStats(store.dir, "atlas");
    assert.equal(stats.count, 2);
    assert.equal(stats.who, "bob", "newest wins, and it is filename-sortable by design");
  });
});

test("addToRoster on a missing project says how to fix it", async () => {
  await withHome(async () => {
    const store = await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    await assert.rejects(() => addToRoster(store.dir, "nope", ["r"]), /varve add nope/);
  });
});

test("the npm test script actually runs the suite", async () => {
  // Shipped broken once: `node --test test/` resolves the directory as a module
  // and exits before running anything. A test command that cannot fail is the
  // same failure mode as having no tests at all.
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.test, /\.test\.mjs|--test\s*$/,
    "the test script must resolve to files, not a bare directory");
});

test("add inherits the memory it resolved, even with two on the machine", async () => {
  // The link step used to re-derive the memory from the repo being linked — but
  // a repo being linked for the first time has no binding, so the answer `add`
  // already had was discarded and resolution failed outright.
  await withHome(async (home) => {
    const bound = join(home, "ims-fe");
    const fresh = join(home, "acme-billing");
    for (const d of [bound, fresh]) await mkdir(d, { recursive: true });

    await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    await initStore({ store: "git@github.com:beta/beta-memory.git", who: "alice" });
    await addProject({ project: "ims", repos: [bound], who: "alice",
      storePath: join(home, "acme-context") });

    process.chdir(bound);
    const r = await addProject({ project: "billing", repos: [fresh], who: "alice" });
    assert.equal(r.dir, join(home, "acme-context"), "resolved from the repo you are standing in");
    assert.deepEqual(r.roster.repos, ["acme-billing"]);
  });
});

test("--memory accepts a name, not only a path", async () => {
  await withHome(async (home) => {
    await initStore({ store: "git@github.com:acme/acme-context.git", who: "alice" });
    await initStore({ store: "git@github.com:beta/beta-memory.git", who: "alice" });
    const loose = join(home, "loose");
    await mkdir(loose, { recursive: true });
    process.chdir(loose);
    // A bare name resolved against cwd used to produce a nonexistent directory.
    const r = await addProject({ project: "ops", storePath: "beta-memory", who: "alice" });
    assert.equal(r.dir, join(home, "beta-memory"));
  });
});
