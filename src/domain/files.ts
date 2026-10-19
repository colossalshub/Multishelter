import path from "node:path";

export type DetectedFile = { mimeType: string; extension: string };

export function detectUpload(bytes: Uint8Array, kind: "image" | "document"): DetectedFile | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mimeType: "image/png", extension: "png" };
  }
  const riff = ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  if (riff) return { mimeType: "image/webp", extension: "webp" };
  if (kind === "document" && ascii(bytes, 0, 5) === "%PDF-") {
    return { mimeType: "application/pdf", extension: "pdf" };
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let i = start; i < end && i < bytes.length; i += 1) text += String.fromCharCode(bytes[i] ?? 0);
  return text;
}

export function safeStoragePath(root: string, storageKey: string): string | null {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(storageKey)) return null;
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, storageKey);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  return full;
}

export function contentDisposition(fileName: string): string {
  const cleaned = fileName.replace(/[\r\n"]/g, "").slice(0, 120) || "download";
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}
