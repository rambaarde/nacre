/**
 * Terminal rendering.
 *
 * Two audiences read this CLI: a person at a terminal, and an agent or CI job
 * reading stdout. They want opposite things — one wants colour, alignment and
 * whitespace, the other wants stable parseable lines with no framing.
 *
 * So the shape is chosen by the destination, the way git, gh and docker do it:
 * a TTY gets the designed output, anything piped gets exactly the plain lines
 * it got before. `NO_COLOR` and `--plain` force the plain path.
 *
 * Zero dependencies. ANSI codes are strings; a TUI framework would be a React
 * tree in a package whose entire install pitch is that it has none.
 */

const NO_COLOR = process.env.NO_COLOR !== undefined || process.env.TERM === "dumb";

/** Styling applies only when a human is looking at it. */
export const isTTY = () =>
  process.stdout.isTTY === true && !NO_COLOR && !process.argv.includes("--plain");

const code = (open, close) => (s) => `[${open}m${s}[${close}m`;
const raw = {
  bold: code(1, 22),
  dim: code(2, 22),
  italic: code(3, 23),
  red: code(31, 39),
  green: code(32, 39),
  yellow: code(33, 39),
  blue: code(34, 39),
  cyan: code(36, 39),
  grey: code(90, 39),
};

/** Style helpers that become the identity function when output is not a TTY. */
export const s = new Proxy(raw, {
  get: (target, key) => (isTTY() ? target[key] : (v) => String(v)),
});

/** Collapse `$HOME` to `~` — the full path is noise in a header. */
export const tilde = (p) => {
  const home = process.env.HOME;
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
};

export const say = (...lines) => lines.filter((l) => l != null).forEach((l) => console.log(l));

/** A labelled row, aligned so values line up down the block. */
export const row = (label, value, width = 9) =>
  `  ${s.grey(label.padEnd(width))}${value}`;

/** Section header: name on the left, a dim summary on the right of the line. */
export function head(left, right = "") {
  const width = Math.min(process.stdout.columns || 80, 72);
  const plain = `  ${left}${right ? `  ${right}` : ""}`;
  if (!isTTY()) return plain;
  const pad = Math.max(1, width - left.length - right.length - 4);
  return `  ${s.bold(left)}${" ".repeat(pad)}${s.grey(right)}`;
}

export const rule = () => {
  const width = Math.min(process.stdout.columns || 80, 72);
  return s.grey("  " + "─".repeat(width - 4));
};

export const ok = (text) => `  ${s.green("✓")} ${text}`;
export const warn = (text) => `  ${s.yellow("!")} ${text}`;
export const bad = (text) => `  ${s.red("✗")} ${text}`;
export const next = (text) => `  ${s.cyan("→")} ${text}`;
export const blank = () => "";
