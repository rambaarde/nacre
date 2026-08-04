#!/usr/bin/env node
/**
 * varve CLI entry point.
 *
 * Parses argv, calls one operation, renders the result. No product logic lives
 * here — that rule exists because the competitor this design learns from let
 * their CLI grow into the engine and is paying for the rewrite.
 *
 * Output follows AXI (https://axi.md/): structured lines on stdout, explicit
 * empty states, `help[]` next steps, exit 0 success / 1 error / 2 unknown flag,
 * and never an interactive prompt when there is no TTY.
 */

import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../src/init.mjs";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const OPTIONS = {
  project: { type: "string" },
  store: { type: "string" },
  "store-path": { type: "string" },
  repo: { type: "string" },
  who: { type: "string" },
  agents: { type: "string" },
  "create-store": { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
};

const USAGE = `varve init — wire this repo to a company context store

  --project <slug>     project this repo belongs to        (required)
  --store <git-url>    the company store repository        (required)
  --store-path <dir>   local clone path   (default: ~/company-context)
  --create-store       scaffold a new store from the template
  --repo <dir>         repo to bind       (default: cwd)
  --who <slug>         author slug        (default: from git config)
  --agents <a,b>       claude,opencode    (default: claude)
  -y, --yes            never prompt

varve reads and writes memory through skills, not this binary. This wires
them up.`;

function fail(message, code = 1) {
  console.log(`error: ${message}`);
  console.log(`help[]: varve init --help`);
  process.exit(code);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ options: OPTIONS, allowPositionals: true, args: process.argv.slice(2) });
  } catch (error) {
    // parseArgs throws on unknown flags — AXI reserves exit 2 for exactly that.
    fail(error.message, 2);
  }

  const { values: opts, positionals } = parsed;
  const command = positionals[0];

  if (opts.version) {
    const pkg = JSON.parse(await readFile(join(PKG_ROOT, "package.json"), "utf8"));
    console.log(pkg.version);
    return;
  }

  if (opts.help || command === "help" || !command) {
    // Bare `varve` shows what it does, not a usage dump — but with nothing
    // configured yet there is no live state to show, so usage is the honest
    // answer here.
    console.log(USAGE);
    return;
  }

  if (command !== "init") {
    fail(`unknown command: ${command} · varve init is the only command`, 2);
  }

  const interactive = process.stdin.isTTY && !opts.yes;

  let result;
  try {
    result = await init(opts, interactive);
  } catch (error) {
    fail(error.message);
  }

  const { project, storePath, who, installed, binding, scaffold } = result;

  console.log(`ok: ${project} initialized`);
  console.log(
    `store: ${storePath}${scaffold.created ? " (scaffolded)" : ""} · ` +
      `binding: ${binding.changed ? "written" : "already present"} · ` +
      `agents[${installed.length}]: ${installed.join(", ") || "none"} · who: ${who}`,
  );
  if (binding.changed) {
    console.log(`next: commit .varve.yml — a teammate who clones this repo starts warm without running init`);
  }
  console.log(`help[]: varve-load (start of session) · varve-publish (end of session)`);
}

main().catch((error) => fail(error.message));
