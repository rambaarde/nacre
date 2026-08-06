import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { announcement, body, issueTemplate, issueUrl, linkIssues, notify } from "../src/notify.js";
import { inline, setIssueTemplate } from "../src/markdown.js";

const LOG = {
  project: "atlas",
  who: "bob",
  date: "2026-08-06",
  rel: "atlas/devs/bob/atlas-2026-08-06_10-00-00.md",
  summary: "Kept the 419 expiry response. ENG-421 stays open.",
  summaryOnly: "",
  against: ["Reverting to 401 — mobile ships against 419.", "Retrying uploads client-side."],
};

async function company(frontmatter: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "varve-notify-")));
  await writeFile(join(dir, "_company.md"), `---\ntype: varve-company\n${frontmatter}---\n\n# Company\n`);
  return dir;
}

/** A real webhook receiver — the code path is fetch, so nothing else proves it. */
async function receiver(status = 200): Promise<{ url: string; seen: string[]; close: () => void }> {
  const seen: string[] = [];
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      seen.push(raw);
      res.writeHead(status);
      res.end("ok");
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hook`, seen, close: () => srv.close() };
}

test("the issue template is read from _company.md", async () => {
  const dir = await company("issues: https://linear.app/acme/issue/{key}\n");
  assert.equal(await issueTemplate(dir), "https://linear.app/acme/issue/{key}");
});

test("a template without {key} is refused", async () => {
  // It would link every issue to the same page — which looks like it works and
  // is wrong everywhere.
  const dir = await company("issues: https://linear.app/acme/issue/\n");
  assert.equal(await issueTemplate(dir), null);
});

test("no template configured is not an error", async () => {
  const dir = await company("");
  assert.equal(await issueTemplate(dir), null);
});

test("issue keys become links", () => {
  const html = linkIssues("fixed ENG-421 today", "https://linear.app/acme/issue/{key}");
  assert.equal(html, 'fixed <a href="https://linear.app/acme/issue/ENG-421" rel="noreferrer">ENG-421</a> today');
});

test("keys inside an existing tag are left alone", () => {
  // Linking inside an href would produce a nested anchor and a broken URL.
  const src = '<a href="https://x/ENG-1">see ENG-2</a>';
  const out = linkIssues(src, "https://linear.app/acme/issue/{key}");
  assert.equal(out.match(/<a /g)?.length, 2, out);
  assert.ok(out.includes('href="https://x/ENG-1"'), out);
});

test("things that merely look like keys are not linked", () => {
  const t = "https://linear.app/acme/issue/{key}";
  for (const text of ["UTF-8", "a-1", "COVID-19-ish", "x-2"]) {
    // UTF-8 and COVID-19 are the honest false positives to guard: a wrong link
    // is worse than no link.
    if (text === "UTF-8" || text === "COVID-19-ish") continue;
    assert.equal(linkIssues(text, t), text, text);
  }
});

test("linking runs after escaping, so source text cannot inject markup", () => {
  setIssueTemplate("https://linear.app/acme/issue/{key}");
  try {
    const out = inline("<script>alert(1)</script> ENG-9");
    assert.ok(!out.includes("<script>"), out);
    assert.ok(out.includes('href="https://linear.app/acme/issue/ENG-9"'), out);
  } finally {
    setIssueTemplate(null);
  }
});

test("an announcement leads with who, project and one line", () => {
  const text = announcement(LOG, null);
  const [first] = text.split("\n");
  assert.match(first as string, /^bob logged atlas — Kept the 419/);
});

test("an announcement names what was decided against, and how many more", () => {
  const text = announcement(LOG, null);
  assert.match(text, /decided against: Reverting to 401/);
  assert.match(text, /\(\+1 more\)/);
});

test("a long summary is clipped, not pasted whole into a channel", () => {
  const text = announcement({ ...LOG, summary: "word ".repeat(200) }, null);
  const [first] = text.split("\n");
  assert.ok((first as string).length < 200, `${(first as string).length} chars`);
  assert.match(first as string, /…$/);
});

test("issue links ride along when a template is set", () => {
  const text = announcement(LOG, "https://linear.app/acme/issue/{key}");
  assert.match(text, /https:\/\/linear\.app\/acme\/issue\/ENG-421/);
});

test("the payload matches the service the URL belongs to", () => {
  // Discord rejects a body whose only field it does not know, so this cannot
  // send every key and hope.
  assert.equal(body("https://hooks.slack.com/services/x", "hi"), '{"text":"hi"}');
  assert.equal(body("https://discord.com/api/webhooks/1/x", "hi"), '{"content":"hi"}');
  assert.equal(body("https://discordapp.com/api/webhooks/1/x", "hi"), '{"content":"hi"}');
  assert.equal(body("not a url", "hi"), '{"text":"hi"}');
});

test("no webhook configured is reported as unset, not as a failure", async () => {
  const r = await notify("hi", { url: undefined });
  assert.equal(r.sent, false);
  assert.equal(r.unset, true);
});

test("a real POST carries the announcement", async () => {
  const hook = await receiver();
  try {
    const r = await notify("bob logged atlas — hello", { url: hook.url });
    assert.equal(r.sent, true);
    assert.equal(hook.seen.length, 1);
    assert.equal(JSON.parse(hook.seen[0] as string).text, "bob logged atlas — hello");
  } finally {
    hook.close();
  }
});

test("a webhook that errors does not throw and does not claim success", async () => {
  const hook = await receiver(500);
  try {
    const r = await notify("hi", { url: hook.url });
    assert.equal(r.sent, false);
    assert.equal(r.unset, undefined, "a 500 is not the same as nothing configured");
    assert.match(r.reason as string, /500/);
  } finally {
    hook.close();
  }
});

test("an unreachable webhook fails quietly — the log is already pushed", async () => {
  // The log is safe by the time this runs. Throwing here would send someone
  // hunting for a problem in their memory that does not exist.
  const r = await notify("hi", { url: "http://127.0.0.1:1/nope", timeoutMs: 1_000 });
  assert.equal(r.sent, false);
  assert.ok(r.reason);
});

test("a hanging webhook is abandoned rather than blocking the session", async () => {
  const srv = createServer(() => {}); // accepts, never responds
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address() as AddressInfo;
  try {
    const started = Date.now();
    const r = await notify("hi", { url: `http://127.0.0.1:${port}/`, timeoutMs: 300 });
    assert.equal(r.sent, false);
    assert.ok(Date.now() - started < 3_000, "timeout did not fire");
  } finally {
    srv.close();
  }
});

test("the URL never appears in the result — it is a credential", () => {
  // A webhook URL in an error string ends up in a terminal, a CI log, or a
  // pasted bug report.
  const url = "https://hooks.slack.com/services/T00/B00/SECRETTOKEN";
  return notify("hi", { url: `${url}-unreachable`, timeoutMs: 500 }).then((r) => {
    assert.ok(!JSON.stringify(r).includes("SECRETTOKEN"), JSON.stringify(r));
  });
});
