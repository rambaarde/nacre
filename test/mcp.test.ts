import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { TOOLS, handle } from "../src/mcp.js";
import { brief, searchText } from "../src/brief.js";
import { resolveStoreDir } from "../src/store.js";

/** A memory with two projects, one shared constraint, one decided-against. */
async function memory(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "varve-mcp-")));
  await writeFile(
    join(dir, "_company.md"),
    `---\ntype: varve-company\ncompany: Acme\n---\n\n<!-- a comment that must not survive -->\n# Shared Infrastructure\n\n* **Redis:** one instance, shared by atlas and beacon.\n`,
  );
  await mkdir(join(dir, "atlas", "devs", "alice"), { recursive: true });
  await writeFile(
    join(dir, "atlas", "_project.md"),
    `---\nproject: atlas\nrepos: [atlas-api, atlas-web]\nteams: [devs]\n---\n\n# Purpose\n\n* **Purpose:** [What problem this product solves]\n`,
  );
  await writeFile(
    join(dir, "atlas", "devs", "alice", "atlas-2026-08-01_09-14-03.md"),
    `---\nproject: atlas\nwho: alice\nrepos: [atlas-api]\n---\n\n## Summary\n\nRate-limit headers renamed.\n\n## Decided against\n\n* Raising the shared cache eviction limit — starves beacon's workers.\n\n## Open risks\n\n* The old header path still ships in atlas-web.\n\n## Next\n\nRemove the old header path.\n`,
  );
  return dir;
}

const call = (name: string, args: Record<string, unknown> = {}) =>
  handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

const text = (msg: Awaited<ReturnType<typeof handle>>): string =>
  ((msg?.result as { content: { text: string }[] }).content[0]?.text ?? "");

test("initialize echoes a protocol version the client asked for", async () => {
  const r = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  const result = r?.result as { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } };
  assert.equal(result.protocolVersion, "2024-11-05");
  assert.equal(result.serverInfo.name, "varve");
  assert.ok(result.capabilities);
});

test("initialize falls back to the latest version it knows", async () => {
  const r = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal((r?.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
});

test("notifications are never answered", async () => {
  // Replying to a notification is a protocol violation some clients treat as fatal.
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(await handle({ jsonrpc: "2.0", id: null, method: "ping" }), null);
});

test("tools/list advertises read-only tools, and nothing that writes", async () => {
  const r = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = (r?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
  assert.deepEqual(names, ["varve_brief", "varve_search"]);
  // The gate that makes publishing safe cannot be enforced from here, so no
  // tool may ever write. This test is the guard on that.
  assert.ok(!names.some((n) => /publish|write|add|init|commit|push/.test(n)));
});

test("every tool advertises a valid schema", () => {
  for (const t of TOOLS) {
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.description.length > 40, `${t.name} needs a description a model can route on`);
  }
});

test("an unknown method is a JSON-RPC error, not a crash", async () => {
  const r = await handle({ jsonrpc: "2.0", id: 7, method: "tools/nope" });
  assert.equal((r?.error as { code: number }).code, -32601);
  assert.equal(r?.id, 7);
});

test("an unknown tool is rejected", async () => {
  const r = await call("varve_publish");
  assert.equal((r?.error as { code: number }).code, -32602);
});

test("brief reads company facts, decided-against and risks", async () => {
  const dir = await memory();
  const out = await brief(dir, "atlas");
  assert.match(out, /Redis.*one instance/);
  assert.match(out, /Decided against/);
  assert.match(out, /starves beacon's workers/);
  assert.match(out, /Open risks/);
  assert.match(out, /Handoff/);
  assert.match(out, /alice/);
  assert.match(out, /repos\[2\]/);
});

test("brief drops unfilled template lines and HTML comments", async () => {
  const dir = await memory();
  const out = await brief(dir, "atlas");
  assert.ok(!out.includes("[What problem this product solves]"), "placeholder leaked into the brief");
  assert.ok(!out.includes("must not survive"), "HTML comment leaked into the brief");
});

test("brief stays inside its token budget", async () => {
  const dir = await memory();
  await mkdir(join(dir, "atlas", "devs", "bob"), { recursive: true });
  for (let i = 0; i < 60; i++) {
    const day = String((i % 28) + 1).padStart(2, "0");
    await writeFile(
      join(dir, "atlas", "devs", "bob", `atlas-2026-08-${day}_10-00-${String(i).padStart(2, "0")}.md`),
      `---\nproject: atlas\nwho: bob\n---\n\n## Decided against\n\n* ${"a rejected approach ".repeat(40)}\n`,
    );
  }
  const out = await brief(dir, "atlas");
  assert.ok(out.length <= 8_400, `brief was ${out.length} chars`);
  // The guarantee is that a cut is announced, not the wording of the notice.
  assert.match(out, /more characters exist/);
});

test("an unknown project names the ones that exist", async () => {
  const dir = await memory();
  const out = await brief(dir, "nope");
  assert.match(out, /No project named "nope"/);
  assert.match(out, /atlas/);
});

test("search flags decided-against rows", async () => {
  const dir = await memory();
  const out = await searchText(dir, "cache", { project: "atlas" });
  assert.match(out, /DECIDED AGAINST/);
});

test("search says so when nothing matches, and what to try", async () => {
  const dir = await memory();
  const out = await searchText(dir, "zzzz", { project: "atlas" });
  assert.match(out, /No match/);
  assert.match(out, /next:/);
});

test("a traversing project name is refused", async () => {
  const r = await call("varve_brief", { project: "../../etc" });
  assert.equal((r?.result as { isError: boolean }).isError, true);
  assert.match(text(r), /Invalid project name/);
});

test("a failure is content the model can read, not a vanished call", async () => {
  // Run somewhere with no .varve.yml above it and no project given.
  const cwd = process.cwd();
  process.chdir(await realpath(await mkdtemp(join(tmpdir(), "varve-nowhere-"))));
  try {
    const r = await call("varve_brief");
    assert.equal((r?.result as { isError: boolean }).isError, true);
    assert.match(text(r), /No project given/);
  } finally {
    process.chdir(cwd);
  }
});

test("the server speaks JSON-RPC on stdio and writes nothing else", async () => {
  // The real failure this guards: one stray console.log corrupts the stream and
  // the client reports a parse error instead of the line that caused it.
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ];
  // spawn, not execFile: promisified execFile has no `input` option (that is
  // execFileSync), so the child's stdin never closes, the read loop never ends,
  // and the test hangs rather than fails.
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/varve.js", import.meta.url)), "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d: string) => (stdout += d));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => (stderr += d));
  child.stdin.end(`${requests.map((r) => JSON.stringify(r)).join("\n")}\n`);

  const code: number | null = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`mcp did not exit when stdin closed. stdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 15_000).unref();
  });
  assert.equal(code, 0, `exited ${code}. stderr:\n${stderr}`);

  const lines = stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 2, `expected 2 replies, got ${lines.length}:\n${stdout}`);
  const parsed = lines.map((l) => JSON.parse(l) as { id: number; jsonrpc: string; result: { tools: unknown[] } });
  assert.deepEqual(parsed.map((p) => p.id), [1, 2]);
  assert.ok(parsed.every((p) => p.jsonrpc === "2.0"));
  assert.equal(parsed[1]?.result.tools.length, 2);
});

test("a company-wide hit names its file rather than an empty date and author", async () => {
  const dir = await memory();
  const out = await searchText(dir, "Redis", { all: true });
  assert.match(out, /_company\.md/);
  assert.ok(!/^\s*·\s+·/m.test(out), `row rendered with empty date/who:\n${out}`);
});

test("a local memory path in .varve.yml is used directly, not re-derived", async () => {
  // The failure this guards: resolution derived ~/<name> from the path's last
  // segment and tried to clone into it, reporting "no projects yet" while
  // pointing at a directory full of them. Every store without a remote hit it.
  const dir = await memory();
  const resolved = await resolveStoreDir(undefined, dir);
  assert.equal(resolved, dir);
});

test("a remote URL still resolves under home, not as a local path", async () => {
  const resolved = await resolveStoreDir(undefined, "git@github.com:acme/acme-context.git");
  assert.equal(basename(resolved), "acme-context", resolved);
  assert.ok(!resolved.startsWith("git@"), resolved);
});

test("a week-one constraint survives twenty newer logs", async () => {
  // The failure a recency window causes, and the reason it matters *during* a
  // two-person pilot rather than after one: two devs over two weeks pass fifteen
  // logs in days. Under a fixed window the oldest constraint stops loading — not
  // ranked lower, gone — while the session still reports it loaded team context.
  // A teammate silently missing week one's constraint reads as "they didn't find
  // it useful", and the pilot gets misread.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "varve-window-")));
  await mkdir(join(dir, "atlas", "devs", "alice"), { recursive: true });
  await writeFile(join(dir, "atlas", "_project.md"),
    "---\nproject: atlas\nrepos: [atlas-api]\nteams: [devs]\n---\n\n# Atlas\n");

  await writeFile(join(dir, "atlas", "devs", "alice", "atlas-2026-08-01_09-00-00.md"),
    "---\nproject: atlas\nwho: alice\n---\n\n## Decided against\n\n* Raising the shared cache limit — it starves beacon's workers.\n");

  await mkdir(join(dir, "atlas", "devs", "bob"), { recursive: true });
  for (let i = 0; i < 20; i++) {
    const day = String(2 + (i % 26)).padStart(2, "0");
    await writeFile(
      join(dir, "atlas", "devs", "bob", `atlas-2026-09-${day}_10-${String(i).padStart(2, "0")}-00.md`),
      `---\nproject: atlas\nwho: bob\n---\n\n## Summary\n\nRoutine session ${i}.\n`,
    );
  }

  const out = await brief(dir, "atlas");
  assert.match(out, /starves beacon's workers/, "the oldest constraint must still load");
  assert.match(out, /Decided against/);
});

test("when the budget truncates, it names what is missing", async () => {
  // A brief that quietly ends looks the same as a project with nothing more to
  // say — the failure the ordering exists to avoid.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "varve-cut-")));
  await mkdir(join(dir, "atlas", "devs", "bob"), { recursive: true });
  await writeFile(join(dir, "atlas", "_project.md"),
    "---\nproject: atlas\nrepos: [atlas-api]\nteams: [devs]\n---\n\n# Atlas\n");
  for (let i = 0; i < 80; i++) {
    await writeFile(
      join(dir, "atlas", "devs", "bob", `atlas-2026-09-01_10-${String(i).padStart(2, "0")}-00.md`),
      `---\nproject: atlas\nwho: bob\n---\n\n## Decided against\n\n* ${"a rejected approach ".repeat(30)}\n`,
    );
  }
  const out = await brief(dir, "atlas");
  assert.match(out, /more characters exist/);
  assert.match(out, /varve search/);
});
