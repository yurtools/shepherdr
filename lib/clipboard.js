// Native composer clipboard extraction. Canonical source: lib/clipboard.js; bin/sync-shared copies it to chat.
// Only an explicit Paste reads the current clipboard. Binary data goes straight to a local file, never stdout.
import { exec, appHome, window } from "herdr";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;
export const isImage = (p) => IMAGE.test(p);
export const paths = (list) => list.filter(Boolean).map((p) => ({ path: p, name: String(p).split("/").filter(Boolean).pop() ?? p, image: isImage(p), temp: false }));

// Local file URLs only. A browser's source URL is image metadata, not a copied file.
export function filePaths(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(line.trim());
    if (!match) continue;
    try {
      const path = decodeURIComponent(match[1]);
      if (!/[\x00-\x1f\x7f]/.test(path) && !out.includes(path)) out.push(path);
    } catch {} // A malformed URL is ordinary text, never a broken paste handler.
  }
  return out;
}

// macOS's clipboard (JXA, osascript): its copied files, one "file\t<path>" line each; else its image (a screenshot is
// PNG or TIFF) written as a PNG to argv[0], "image"; else nothing.
export const MAC_CLIPBOARD = `ObjC.import("AppKit");
function run(argv) {
  const pb = $.NSPasteboard.generalPasteboard;
  const urls = pb.readObjectsForClassesOptions($([$.NSURL]), $({ NSPasteboardURLReadingFileURLsOnlyKey: true }));
  if (urls && !urls.isNil() && urls.count > 0) {
    const out = [];
    for (let i = 0; i < urls.count; i++) out.push("file\\t" + urls.objectAtIndex(i).path.js);
    return out.join("\\n");
  }
  let png = pb.dataForType($.NSPasteboardTypePNG);
  if (!png || png.isNil()) {
    const tiff = pb.dataForType($.NSPasteboardTypeTIFF);
    if (tiff && !tiff.isNil()) png = $.NSBitmapImageRep.imageRepWithData(tiff).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  }
  if (png && !png.isNil() && png.writeToFileAtomically(argv[0], true)) return "image";
  return "";
}`;

let sequence = 0;
const pastedName = (ext) => `pasted-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
const READERS = {
  wayland: { list: ["wl-paste", ["--list-types"]], read: (type) => ["wl-paste", ["--no-newline", "--type", type]] },
  x11: { list: ["xclip", ["-selection", "clipboard", "-out", "-target", "TARGETS"]], read: (type) => ["xclip", ["-selection", "clipboard", "-out", "-target", type]] },
};
const imageError = (message) => Object.assign(new Error(message), { clipboardImage: true });
const FORMATS = [["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["image/gif", "gif"], ["image/bmp", "bmp"], ["image/tiff", "tiff"]];

// Frame-only feedbackPasteImage is not available to mods. Use the established OS readers:
// AppKit on macOS, wl-clipboard on Wayland, xclip on X11. No PRIMARY/history reads or clipboard writes.
export async function fromClipboard(os = window()?.platform) {
  const dir = `${appHome()}/data/chat-attach`;
  if (os === "macos") {
    const name = pastedName("png");
    const r = await exec("sh", ["-c", 'umask 077; mkdir -p "$1" && exec osascript -l JavaScript -e "$2" "$1/$3"', "x", dir, MAC_CLIPBOARD, name]);
    if (r.code !== 0) throw new Error("Couldn't read the clipboard.");
    const out = r.stdout.trim();
    if (out === "image") return [{ path: `${dir}/${name}`, name, image: true, temp: true }];
    return paths(out.split("\n").filter((l) => l.startsWith("file\t")).map((l) => l.slice(5)));
  }
  if (os !== "linux") throw new Error("Image paste isn't supported on this platform.");
  const backend = await exec("sh", ["-c", 'if [ -n "$WAYLAND_DISPLAY" ] && command -v wl-paste >/dev/null; then echo wayland; elif [ -n "$DISPLAY" ] && command -v xclip >/dev/null; then echo x11; elif command -v wl-paste >/dev/null; then echo wayland; else exit 127; fi']);
  const reader = READERS[backend.stdout.trim()];
  if (!reader) throw new Error("Couldn't read clipboard images: install wl-paste (wl-clipboard) on Wayland or xclip on X11.");
  const listed = await exec(...reader.list);
  if (listed.code !== 0) throw new Error("Couldn't read the clipboard. Check the clipboard reader and desktop connection.");
  const types = listed.stdout.split(/\r?\n/).map((t) => t.trim());
  if (types.includes("text/uri-list")) {
    const r = await exec(...reader.read("text/uri-list"));
    if (r.code !== 0) throw new Error("Couldn't read the clipboard's files.");
    const files = filePaths(r.stdout);
    if (files.length) return paths(files);
  }
  const format = FORMATS.find(([type]) => types.includes(type));
  if (!format) {
    if (types.some((t) => t.startsWith("image/"))) throw imageError("That clipboard image format isn't supported. Copy it as PNG or attach the file.");
    return [];
  }
  const [type, ext] = format, name = pastedName(ext);
  const [cmd, args] = reader.read(type);
  const r = await exec("sh", ["-c", 'umask 077; mkdir -p "$1" || exit; p="$1/$2"; shift 2; if "$@" > "$p" && [ -s "$p" ]; then echo ok; else rm -f "$p"; exit 1; fi', "x", dir, name, cmd, ...args]);
  if (r.code !== 0 || r.stdout.trim() !== "ok") throw imageError("Couldn't read the clipboard image. Copy it again and retry Paste.");
  return [{ path: `${dir}/${name}`, name, image: true, temp: true }];
}
