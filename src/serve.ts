/**
 * The human door: a local read-only portal over your own clone.
 *
 * A node:http server rather than a site generator. The local portal is a live
 * process reading a checkout, so a build step buys nothing here — and a
 * framework would be a dependency tree inside a package whose install pitch is
 * that it has none.
 *
 * No auth, and none needed: it binds loopback and serves a clone you already
 * have. Whoever can read the memory can already read it.
 *
 * Layout follows the design the store's shape implies — three entry axes, a
 * flat rail with counts, and a project page ordered by urgency of not knowing
 * rather than by recency. Colour carries meaning only.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { exists } from "./store.js";
import { markdown, escape } from "./markdown.js";
import { tilde } from "./render.js";
import { index, projectView, personView, search, age, readLogs, projectStandards } from "./portal.js";
import type { Hit, Log } from "./portal.js";

type Index = Awaited<ReturnType<typeof index>>;
type ProjectView = NonNullable<Awaited<ReturnType<typeof projectView>>>;
type PersonView = Awaited<ReturnType<typeof personView>>;
type Active = { project?: string; who?: string; month?: string; company?: string; section?: string };

const CSS = `
:root{--ink:#16150f;--soft:#55524a;--faint:#8a867c;--paper:#faf8f3;--paper2:#f2efe7;
--rule:#ddd8cc;--hard:#16150f;--declined:#8c3a2b;--risk:#9a6b12;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--prose:Iowan Old Style,Palatino,Georgia,serif}
@media(prefers-color-scheme:dark){:root{--ink:#e8e4d9;--soft:#a6a196;--faint:#6f6a60;
--paper:#14130f;--paper2:#1c1a15;--rule:#2e2b23;--hard:#e8e4d9;--declined:#d97a63;--risk:#d8a53f}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--prose);font-size:16px;line-height:1.6}
a{color:inherit}
.top{display:flex;gap:.8rem;align-items:baseline;flex-wrap:wrap;padding:.7rem 1.1rem;
border-bottom:2px solid var(--hard);font-family:var(--mono);font-size:.74rem;color:var(--faint)}
.top .brand{color:var(--ink);font-weight:700;letter-spacing:.05em;text-decoration:none}
.top .right{margin-left:auto}
.cols{display:grid;grid-template-columns:1fr}
@media(min-width:52rem){.cols{grid-template-columns:14rem minmax(0,1fr)}}
.rail{padding:1rem;font-family:var(--mono);font-size:.76rem;border-bottom:1px solid var(--rule)}
@media(min-width:52rem){.rail{border-bottom:0;border-right:1px solid var(--rule);min-height:calc(100vh - 3rem)}}
.rail h4{font-size:.65rem;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:0 0 .4rem;font-weight:600}
.rail ul{list-style:none;margin:0 0 1.3rem;padding:0}
.rail li{display:flex;justify-content:space-between;gap:1rem;padding:.12rem 0}
.rail a{color:var(--soft);text-decoration:none;display:flex;justify-content:space-between;width:100%}
.rail a:hover{color:var(--ink)}
.rail .on a,.rail .on{color:var(--ink);font-weight:700}
.rail .n{color:var(--faint);font-variant-numeric:tabular-nums}
.pane{padding:1.2rem 1.4rem 3rem;min-width:0}
.pane h1{font-size:1.5rem;margin:0 0 .1rem;font-weight:600}
.sub{font-family:var(--mono);font-size:.74rem;color:var(--faint);margin:0 0 1.6rem}
.bh{font-family:var(--mono);font-size:.67rem;letter-spacing:.15em;text-transform:uppercase;
display:flex;align-items:baseline;gap:.8rem;margin:0 0 .45rem}
.bh .cnt{margin-left:auto;color:var(--faint);font-variant-numeric:tabular-nums}
hr.thin{border:0;border-top:1px solid var(--rule);margin:0 0 .8rem}
hr.dbl{border:0;border-top:3px double var(--declined);margin:0 0 .8rem}
.block{margin:0 0 2.1rem;max-width:38rem}
.item{border-left:3px solid var(--declined);padding-left:.8rem;margin:0 0 .9rem}
.item .what{font-family:var(--mono);font-size:.82rem;font-weight:700;color:var(--declined)}
.item .by{font-family:var(--mono);font-size:.72rem;color:var(--faint)}
.risk{border-left:3px solid var(--risk);padding-left:.8rem;margin:0 0 .7rem;
font-family:var(--mono);font-size:.8rem}
.decision{border-left:3px solid var(--soft);padding-left:.8rem;margin:0 0 .9rem}
.decision .what{font-family:var(--mono);font-size:.82rem;color:var(--ink)}
.decision .by{font-family:var(--mono);font-size:.72rem;color:var(--faint)}
table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:.78rem}
td{padding:.3rem .8rem .3rem 0;border-bottom:1px solid var(--rule);vertical-align:top}
td.d,td.w,td.r{color:var(--faint);white-space:nowrap}
td a{text-decoration:none}
td a:hover{text-decoration:underline}
.scroll{overflow-x:auto}
form.q{display:flex;gap:.5rem;font-family:var(--mono);font-size:.8rem;margin:0 0 1.2rem}
form.q input[type=search]{flex:1;min-width:0;background:var(--paper2);border:1px solid var(--rule);
color:var(--ink);padding:.35rem .6rem;font:inherit}
form.q button{background:none;border:1px solid var(--rule);color:var(--soft);padding:.35rem .7rem;font:inherit;cursor:pointer}
.log,.note{max-width:38rem}
.note h1,.note h2{font-size:1.02rem;margin:1.3rem 0 .3rem;font-family:var(--mono);
letter-spacing:.04em;text-transform:uppercase;color:var(--faint);font-weight:600}
.note li{margin:.15rem 0}
.log h2,.log h3{font-size:1.05rem;margin:1.4rem 0 .3rem}
.log pre{background:var(--paper2);padding:.7rem .9rem;overflow-x:auto;font-size:.8rem}
.log code{font-family:var(--mono);font-size:.86em}
.empty{font-family:var(--mono);font-size:.78rem;color:var(--faint)}
`;

const page = (title: string, body: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · varve</title><style>${CSS}</style></head><body>${body}</body></html>`;

const link = (href: string, text: string): string => `<a href="${escape(href)}">${escape(text)}</a>`;

function rail(idx: Index, active: Active = {}): string {
  const group = (label: string, entries: Record<string, number>, prefix: string, key: keyof Active): string => {
    const rows = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));
    if (!rows.length) return `<h4>${label}</h4><ul><li class="n">none yet</li></ul>`;
    return `<h4>${label}</h4><ul>${rows
      .map(([name, n]) => `<li class="${active[key] === name ? "on" : ""}">${
        link(`${prefix}${encodeURIComponent(name)}`, name)
      }<span class="n">${n}</span></li>`)
      .join("")}</ul>`;
  };
  const project = active.project
    ? `<h4>${escape(active.project)}</h4><ul>
        <li class="${active.section !== "standards" ? "on" : ""}">${link(`/p/${encodeURIComponent(active.project)}`, "overview")}</li>
        <li class="${active.section === "standards" ? "on" : ""}">${link(`/s/${encodeURIComponent(active.project)}`, "standards")}</li>
      </ul>`
    : "";

  return `<nav class="rail">
    ${project}
    <h4>Company</h4>
    <ul>
      <li class="${active.company === "_company" ? "on" : ""}">${link("/c/_company", "context")}</li>
      <li class="${active.company === "_standards" ? "on" : ""}">${link("/c/_standards", "standards")}</li>
    </ul>
    ${group("Projects", idx.projects, "/p/", "project")}
    ${group("People", idx.people, "/who/", "who")}
    ${group("Time", idx.months, "/t/", "month")}
  </nav>`;
}

const shell = (memory: string, clone: string, idx: Index, active: Active, title: string, inner: string): string => page(title, `
  <div class="top">
    <a class="brand" href="/">varve</a><span>· ${escape(basename(memory))}</span>
    <span class="right">${escape(tilde(memory))} · pulled ${escape(clone)}</span>
  </div>
  <div class="cols">${rail(idx, active)}<div class="pane">${inner}</div></div>`);

const searchForm = (q = "", scope = ""): string => `<form class="q" method="get" action="/search">
  <input type="search" name="q" value="${escape(q)}" placeholder="search…" autofocus>
  ${scope ? `<input type="hidden" name="project" value="${escape(scope)}">` : ""}
  <button type="submit">search</button>
  ${scope ? `<button type="submit" name="all" value="1">all projects</button>` : ""}
</form>`;

const logRows = (logs: Log[], showProject = false): string => logs.length
  ? `<div class="scroll"><table>${logs.map((l) => `<tr>
      <td class="d">${escape(l.date)}</td>
      <td class="w">${escape(l.who)}</td>
      <td class="r">${escape(showProject ? l.project : (l.repos[0] ?? ""))}</td>
      <td>${link(`/log/${encodeURIComponent(l.rel)}`, l.summary.split("\n").find((x) => x.trim())?.replace(/^#+\s*/, "").slice(0, 90) || l.id)}</td>
    </tr>`).join("")}</table></div>`
  : `<p class="empty">no logs yet — run varve-publish at the end of a session</p>`;

/** Project page. Order is urgency of not knowing, not recency. */
function renderProject(v: ProjectView): string {
  return `<h1>${escape(v.title)}</h1>
  <p class="sub">repos[${v.repos.length}] ${escape(v.repos.join(", ") || "none linked")}${
    v.teams.length ? ` · teams[${v.teams.length}] ${escape(v.teams.join(", "))}` : ""
  } · ${v.count} log${v.count === 1 ? "" : "s"}${
    v.hasStandards ? ` · ${link(`/s/${encodeURIComponent(v.project)}`, "standards")}` : ""
  }</p>
  ${searchForm("", v.project)}
  ${v.handoff ? `<div class="bh"><span>Handoff</span><span class="cnt">${
    escape(v.handoffBy ? `${v.handoffBy.who} · ${v.handoffBy.date}` : "")
  }</span></div><hr class="thin"><div class="block">${markdown(v.handoff)}</div>` : ""}
  ${v.note ? `<div class="bh"><span>Project note</span><span class="cnt">curated</span></div>
  <hr class="thin"><div class="block note">${markdown(v.note)}</div>` : ""}
  <div class="bh"><span style="color:var(--declined)">Recently decided against</span><span class="cnt">${
    v.againstTotal > v.against.length ? `${v.against.length} of ${v.againstTotal}` : v.against.length
  }</span></div>
  <hr class="dbl">
  <div class="block">${v.against.length
    ? v.against.map((a) => `<div class="item"><div class="what">${escape(a.what)}</div>
        <div class="by">${escape(a.who)} · ${escape(a.date)}</div></div>`).join("")
    : '<p class="empty">nothing recorded yet</p>'}
    ${v.againstTotal > v.against.length
      ? `<p class="empty">the durable ones belong in the project note · ${link(`/search?q=&project=${encodeURIComponent(v.project)}`, "search the rest")}</p>`
      : ""}</div>
  <div class="bh"><span style="color:var(--risk)">Open risks</span><span class="cnt">${v.risks.length}</span></div>
  <hr class="thin">
  <div class="block">${v.risks.length
    ? v.risks.map((r) => `<div class="risk">${escape(r.what)} <span style="color:var(--faint)">${escape(r.who)} · ${escape(r.date)}</span></div>`).join("")
    : '<p class="empty">none</p>'}</div>
  <div class="bh"><span>Recent</span><span class="cnt">${v.count} logs</span></div>
  <hr class="thin">${logRows(v.logs)}`;
}

function renderPerson(v: PersonView): string {
  return `<h1>${escape(v.who)}</h1>
  <p class="sub">projects[${v.projects.length}] ${escape(v.projects.join(", ") || "none")} · ${v.count} log${v.count === 1 ? "" : "s"}</p>
  ${v.decisions.length ? `<div class="bh"><span>Decisions</span><span class="cnt">${v.decisions.length}</span></div>
  <hr class="thin">
  <div class="block">${v.decisions.map((d) => `<div class="decision"><div class="what">${escape(d.what)}</div>
    <div class="by">${escape(d.project)} · ${escape(d.date)}</div></div>`).join("")}</div>` : ""}
  <div class="bh"><span style="color:var(--declined)">Decided against</span><span class="cnt">${v.against.length}</span></div>
  <hr class="dbl">
  <div class="block">${v.against.length
    ? v.against.map((a) => `<div class="item"><div class="what">${escape(a.what)}</div>
        <div class="by">${escape(a.project)} · ${escape(a.date)}</div></div>`).join("")
    : '<p class="empty">nothing recorded yet</p>'}</div>
  <div class="bh"><span>Logs</span><span class="cnt">${v.count}</span></div>
  <hr class="thin">${logRows(v.logs, true)}`;
}

function renderSearch(q: string, hits: Hit[], scope: string, all: boolean): string {
  return `<h1>search</h1>
  <p class="sub">${escape(q ? `“${q}”` : "")} · scope: ${escape(all ? "all projects" : scope || "all projects")} · ${hits.length} hit${hits.length === 1 ? "" : "s"}</p>
  ${searchForm(q, scope)}
  ${hits.length
    ? `<div class="scroll"><table>${hits.map((h) => `<tr>
        <td class="d">${escape(h.date)}</td><td class="w">${escape(h.who)}</td>
        <td class="r">${escape(h.repo)}</td>
        <td>${h.against ? '<span style="color:var(--declined);font-weight:700">▌</span> ' : ""}${
          link(`/log/${encodeURIComponent(h.rel)}`, h.line.slice(0, 110))}</td></tr>`).join("")}</table></div>`
    : q ? `<p class="empty">no hits for “${escape(q)}”</p>` : ""}`;
}

/**
 * Start the portal. Returns the server so a caller — or a test — can close it.
 */
export interface ServeOptions { memory: string; port?: number; host?: string }

export async function serve({ memory, port = 4173, host = "127.0.0.1" }: ServeOptions) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      const idx = await index(memory);
      const clone = await age(memory);
      const send = (html: string, status = 200): void => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html);
      };

      const project = url.pathname.match(/^\/p\/(.+)$/);
      if (project) {
        const name = decodeURIComponent(project[1] as string);
        const v = await projectView(memory, name);
        if (!v) return send(shell(memory, clone, idx, {}, name, `<h1>${escape(name)}</h1><p class="empty">no such project</p>`), 404);
        return send(shell(memory, clone, idx, { project: name }, v.title, renderProject(v)));
      }

      const person = url.pathname.match(/^\/who\/(.+)$/);
      if (person) {
        const who = decodeURIComponent(person[1] as string);
        const v = await personView(memory, who);
        return send(shell(memory, clone, idx, { who }, who, renderPerson(v)));
      }

      const month = url.pathname.match(/^\/t\/(.+)$/);
      if (month) {
        const m = decodeURIComponent(month[1] as string);
        const logs = (await readLogs(memory)).filter((l) => l.date.startsWith(m));
        return send(shell(memory, clone, idx, { month: m }, m,
          `<h1>${escape(m)}</h1><p class="sub">${logs.length} log${logs.length === 1 ? "" : "s"}</p>${logRows(logs, true)}`));
      }

      const log = url.pathname.match(/^\/log\/(.+)$/);
      if (log) {
        const rel = decodeURIComponent(log[1] as string);
        // Path is taken from the index, never from user input beyond matching it.
        const all = await readLogs(memory);
        const found = all.find((l) => l.rel === rel);
        if (!found) return send(shell(memory, clone, idx, {}, "not found", '<p class="empty">no such log</p>'), 404);
        return send(shell(memory, clone, idx, { project: found.project, who: found.who }, found.id,
          `<h1>${escape(found.id)}</h1><p class="sub">${escape(found.who)} · ${escape(found.project)}${
            found.repos.length ? ` · repos[${found.repos.length}] ${escape(found.repos.join(", "))}` : ""
          }</p><div class="log">${markdown(found.body)}</div>`));
      }

      const projStd = url.pathname.match(/^\/s\/(.+)$/);
      if (projStd) {
        const name = decodeURIComponent(projStd[1] as string);
        const text = await projectStandards(memory, name);
        if (text === null) {
          return send(shell(memory, clone, idx, { project: name }, name,
            `<p class="empty">${escape(name)} has no standards of its own — the company standards apply</p>`), 404);
        }
        return send(shell(memory, clone, idx, { project: name, section: "standards" }, `${name} standards`,
          `<h1>${escape(name)} — standards</h1>
           <p class="sub">${escape(name)}/_standards.md · loaded with this project only</p>
           <div class="log">${markdown(text.replace(/^(?:\s|<!--[\s\S]*?-->)*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/<!--[\s\S]*?-->/g, ""))}</div>`));
      }

      const company = url.pathname.match(/^\/c\/(_company|_standards)$/);
      if (company) {
        const name = company[1] as string;
        const path = join(memory, `${name}.md`);
        if (!(await exists(path))) {
          return send(shell(memory, clone, idx, {}, name, `<p class="empty">no ${name}.md in this memory</p>`), 404);
        }
        const text = await readFile(path, "utf8");
        const title = name === "_company" ? "Company context" : "Engineering standards";
        return send(shell(memory, clone, idx, { company: name }, title, `<h1>${escape(title)}</h1>
          <p class="sub">${escape(name)}.md · loaded into every brief, in every project</p>
          <div class="log">${markdown(text.replace(/^(?:\s|<!--[\s\S]*?-->)*---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""))}</div>`));
      }

      if (url.pathname === "/search") {
        const q = url.searchParams.get("q") ?? "";
        const scope = url.searchParams.get("project") ?? "";
        const all = url.searchParams.get("all") === "1" || !scope;
        const hits = q ? await search(memory, q, { project: scope, all }) : [];
        return send(shell(memory, clone, idx, {}, "search", renderSearch(q, hits, scope, all)));
      }

      if (url.pathname === "/") {
        const names = Object.keys(idx.projects);
        if (names.length === 1) {
          const v = (await projectView(memory, names[0] as string)) as ProjectView;
          return send(shell(memory, clone, idx, { project: names[0] as string }, v.title, renderProject(v)));
        }
        return send(shell(memory, clone, idx, {}, basename(memory), `
          <h1>${escape(basename(memory))}</h1>
          <p class="sub">projects[${names.length}] · ${idx.total} log${idx.total === 1 ? "" : "s"}</p>
          ${searchForm()}
          ${names.length
            ? `<div class="scroll"><table>${names.map((n) => `<tr><td>${link(`/p/${encodeURIComponent(n)}`, n)}</td><td class="d">${idx.projects[n]} logs</td></tr>`).join("")}</table></div>`
            : '<p class="empty">no projects yet — run varve add &lt;project&gt; &lt;repo-dir&gt;</p>'}`));
      }

      send(shell(memory, clone, idx, {}, "not found", '<p class="empty">not found</p>'), 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`error: ${message}\n`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const bound = typeof address === "object" && address ? address.port : port;
  return { server, url: `http://${host}:${bound}` };
}
