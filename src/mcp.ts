/**
 * An MCP server over the memory — the read door for agents that are not Claude
 * Code.
 *
 * Why this exists: the two skills are Claude Code files. A teammate on Cursor,
 * Zed or Codex has no way to read the memory at all, and a team memory only one
 * agent can read is not a team memory.
 *
 * Why it is read-only: `varve-publish` is safe because a person sees the file
 * and says yes before anything is pushed. A tool is a function the client calls
 * whenever it likes, and no server can guarantee a human saw the result first.
 * Exposing publish here would either weaken "nothing is shared by omission" or
 * fake a gate in a loop this process does not control. Writing stays with the
 * skill and the CLI, where the gate is real.
 *
 * Transport is newline-delimited JSON-RPC 2.0 on stdio, hand-rolled because the
 * official SDK would be this package's first runtime dependency.
 *
 * **Nothing may ever be written to stdout except protocol messages.** A stray
 * console.log corrupts the stream and the client reports a parse error rather
 * than the line that caused it. Diagnostics go to stderr.
 */
import { join } from "node:path";
import { createInterface } from "node:readline";

import { isSafeName, resolveBinding, resolveStoreDir, exists } from "./store.js";
import { brief, searchText } from "./brief.js";

/** The revisions whose handshake this server understands. */
const PROTOCOL = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const LATEST = PROTOCOL[0];

/** What the process was started with. Passed rather than held in a module
 *  global so the protocol stays testable by calling a function. */
export interface Ctx {
  version?: string;
  /** --memory: which memory, when a machine has more than one. */
  memory?: string;
}

export interface Message {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export const TOOLS = [
  {
    name: "varve_brief",
    description:
      "Read the team's shared memory for a project: company-wide facts, standards, " +
      "the curated project note, what has been decided against, open risks, the " +
      "handoff, and the newest session summaries. Call this at the start of a " +
      "session, before writing code, so you begin knowing what the team already " +
      "decided. Read-only; no model call.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description:
            "Project name. Omit to use the .varve.yml found by walking up from the " +
            "working directory.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "varve_search",
    description:
      "Search the shared memory. Same ranking as the portal. Lines from a log " +
      "marked 'decided against' are flagged, because re-proposing one is the " +
      "failure this store exists to prevent.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for." },
        project: { type: "string", description: "Restrict to one project." },
        all: {
          type: "boolean",
          description: "Search every project rather than the current one.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
] as const;

/** Where to read from, and which project, when the caller did not say. */
async function resolve(project: string | undefined, memoryFlag?: string): Promise<{ memory: string; project: string } | string> {
  if (project !== undefined && !isSafeName(project)) return `Invalid project name: ${project}`;

  const binding = await resolveBinding();
  const chosen = project ?? binding?.project;
  if (!chosen) {
    return (
      "No project given, and no .varve.yml found by walking up from " +
      `${process.cwd()}.\nPass project, or run varve add <project> <repo-dir> in this repo.`
    );
  }
  try {
    const memory = await resolveStoreDir(memoryFlag, binding?.store ?? null);
    if (!(await exists(memory))) {
      return `The memory is not cloned here yet (looked in ${memory}).\nnext: varve init <git-url>, or clone it beside your repos.`;
    }
    return { memory, project: chosen };
  } catch (err) {
    return `Could not resolve the memory: ${(err as Error).message}`;
  }
}

const ok = (id: Message["id"], result: unknown): Message => ({ jsonrpc: "2.0", id, result });
const fail = (id: Message["id"], code: number, message: string): Message => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
/** A tool that could not answer reports it as content, not as a protocol error:
 *  the model should see the reason and adapt, not have the call disappear. */
const toolText = (id: Message["id"], text: string, isError = false): Message =>
  ok(id, { content: [{ type: "text", text }], isError });

/**
 * One request in, one response out. `null` means notification — nothing is sent.
 *
 * Kept free of stdio so the whole protocol is testable by calling a function.
 */
export async function handle(msg: Message, ctx: Ctx = {}): Promise<Message | null> {
  const { id, method } = msg;
  // Notifications carry no id and must never be answered; replying to one is a
  // protocol violation that some clients treat as fatal.
  if (id === undefined || id === null) return null;

  switch (method) {
    case "initialize": {
      const asked = (msg.params?.protocolVersion as string) ?? "";
      return ok(id, {
        protocolVersion: PROTOCOL.includes(asked as (typeof PROTOCOL)[number]) ? asked : LATEST,
        capabilities: { tools: {} },
        serverInfo: { name: "varve", version: ctx.version ?? "0.0.0" },
        instructions:
          "Call varve_brief at the start of a session, before writing code. It is " +
          "read-only and costs no model call. This server cannot write to the " +
          "memory: publishing a session log is human-invoked, through the " +
          "varve-publish skill or the varve CLI.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = msg.params?.name as string;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${name}`);

      const scope = await resolve(args.project as string | undefined, ctx.memory);
      if (typeof scope === "string") return toolText(id, scope, true);

      try {
        if (name === "varve_brief") return toolText(id, await brief(scope.memory, scope.project));
        const query = String(args.query ?? "").trim();
        if (!query) return toolText(id, "varve_search needs a query.", true);
        return toolText(
          id,
          await searchText(scope.memory, query, {
            project: scope.project,
            all: args.all === true,
          }),
        );
      } catch (err) {
        return toolText(id, `Read failed: ${(err as Error).message}`, true);
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/** Read the loop until stdin closes. Resolves when the client disconnects. */
export async function serve(ctx: Ctx = {}): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    let msg: Message;
    try {
      msg = JSON.parse(text) as Message;
    } catch {
      // No id is recoverable from unparseable input, so this is the one case
      // that answers with a null id, per JSON-RPC.
      process.stdout.write(`${JSON.stringify(fail(null, -32700, "Parse error"))}\n`);
      continue;
    }
    const reply = await handle(msg, ctx).catch((err: Error) => fail(msg.id ?? null, -32603, err.message));
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
  }
}
