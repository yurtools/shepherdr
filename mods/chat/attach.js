// Files for the message box: pasted (a clipboard image, or copied files) or dropped. They go
// to the agent the way its CLI reads them: as file paths in the message (Claude Code turns an
// image path into an image). An agent on another machine gets a copy there first (`hc put`).
// Pasted images are kept in data/chat-attach until the person sends or removes them.

import { exec, hc, appHome, window } from "herdr";
import * as fs from "fs/promises";

export { fromClipboard, MAC_CLIPBOARD, filePaths, isImage, paths } from "./clipboard.js";

// macOS's own file picker, several files at once (AppleScript's choose file, over the window in front): each chosen
// path on its own line; nothing when cancelled.
export const MAC_PICK = [
  "on run argv",
  "  try",
  "    tell application (path to frontmost application as text) to set fs to choose file with prompt (item 1 of argv) with multiple selections allowed",
  "  on error number -128",
  "    return \"\"",
  "  end try",
  "  set out to {}",
  "  repeat with f in fs",
  "    set end of out to POSIX path of f",
  "  end repeat",
  "  set AppleScript's text item delimiters to linefeed",
  "  return out as text",
  "end run",
];

// The desktop's own file picker, for the attach button: xdg-desktop-portal's on Linux (pick-files.py), macOS's own.
// Resolves { code, paths }.
export async function pick(title = "Attach files", os = window()?.platform) {
  const r = os === "macos"
    ? await exec("osascript", [...MAC_PICK.flatMap((l) => ["-e", l]), title]).catch(() => null)
    : await exec("sh", ["-c", 'P=/usr/bin/python3; [ -x "$P" ] || P=python3; exec "$P" -I "$1" "$2"', "x", `${appHome()}/mods/chat/pick-files.py`, title]).catch(() => null);
  return { code: r ? r.code : 1, paths: (r?.stdout ?? "").split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean) };
}

// The message's file lines: each file's path where the agent is. For another machine, a copy
// lands beside the agent's terminal.
export async function deliver(files, addr, machine) {
  const out = [];
  for (const f of files) {
    if (f.reference && (f.on ?? null) === (machine ?? null)) { out.push(f.path); continue; }
    if (f.on && f.on !== machine) throw new Error('A remote file reference must be sent to an agent on the same computer.');
    if (!machine) { out.push(f.path); continue; }
    const r = await hc(["put", addr, f.path, "--json"]);
    let landed = null;
    try { landed = JSON.parse(r.stdout || "{}").path ?? null; } catch { landed = r.stdout.trim() || null; }
    if (r.code !== 0 || !landed) throw new Error(`${f.name} didn't reach ${machine}: ${(r.stderr || r.stdout).trim()}`);
    out.push(landed);
  }
  return out;
}

// A pasted image removed before sending goes. Sent ones stay a day (the agent may read them
// later), then go.
export function drop(f) {
  if (f.temp && f.path.startsWith(`${appHome()}/data/chat-attach/`)) exec("rm", ["-f", f.path]);
}
export function prune() {
  exec("sh", ["-c", 'find "$1" -name "pasted-*" -mmin +1440 -delete 2>/dev/null; true', "x", `${appHome()}/data/chat-attach`]);
}

// Images shown in the chat (thumbnails, the viewer): `image()` loads from the app's folder, so
// each one is linked (or copied) into data/chat-attach/view, with its pixel size for fitting.
// Resolves { <path>: { rel, w, h } } for the ones that exist here and are images.
const VIEW = `
d="$1"; shift; mkdir -p "$d"
for p in "$@"; do
  [ -f "$p" ] || continue
  s=$(magick identify -format '%w %h' "$p[0]" 2>/dev/null) || s=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$p" 2>/dev/null | tr ',' ' ')
  [ -n "$s" ] || continue
  n=$(printf '%s' "$p" | cksum | cut -d' ' -f1)-$(printf '%s' "\${p##*/}" | tr -c 'A-Za-z0-9._-' '_')
  [ -f "$d/$n" ] || ln -f "$p" "$d/$n" 2>/dev/null || cp "$p" "$d/$n" 2>/dev/null || continue
  printf '%s\\t%s\\t%s\\n' "$p" "$n" "$s"
done
true`;
export async function viewable(list) {
  const dir = `${appHome()}/data/chat-attach/view`;
  const r = await exec("sh", ["-c", VIEW, "view", dir, ...list]).catch(() => null);
  const out = {};
  for (const line of (r?.stdout ?? "").split("\n")) {
    const [p, n, size] = line.split("\t");
    const [w, h] = (size ?? "").split(" ").map(Number);
    if (p && n && w && h) out[p] = { rel: `data/chat-attach/view/${n}`, w, h };
  }
  return out;
}

// A w×h image covering a size×size square: its drawn size and offset (the middle shows).
export function cover(w, h, size) {
  const k = size / Math.min(w, h);
  const dw = Math.round(w * k), dh = Math.round(h * k);
  return { w: dw, h: dh, left: Math.round((size - dw) / 2), top: Math.round((size - dh) / 2) };
}

// A big paste kept as a text file (sent by path like other files): data/chat-attach, named
// after its first line.
export async function textFile(text) {
  const first = String(text).split("\n").find((l) => l.trim())?.trim() ?? "pasted text";
  const slug = first.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "pasted-text";
  const name = `pasted-${Date.now().toString(36)}-${slug}.txt`;
  const path = `${appHome()}/data/chat-attach/${name}`;
  try {
    await exec("mkdir", ["-p", `${appHome()}/data/chat-attach`]);
    await fs.writeFile(path, text);
  } catch { return null; }
  return { path, name: first.length > 40 ? first.slice(0, 39) + "…" : first, image: false, text: true, temp: true };
}
