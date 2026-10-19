import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError, notFound } from "@/domain/errors";
import { detectUpload, safeStoragePath, type DetectedFile } from "@/domain/files";
import { newSecret } from "@/server/crypto";

const IMAGE_LIMIT = 8_000_000;
const DOCUMENT_LIMIT = 10_000_000;

export function storageRoot(): string {
  return path.resolve(process.env.STORAGE_PATH || path.join(process.cwd(), "storage"));
}

export async function storeUpload(orgId: string, bytes: Buffer, kind: "image" | "document"): Promise<{
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const limit = kind === "image" ? IMAGE_LIMIT : DOCUMENT_LIMIT;
  if (bytes.length === 0 || bytes.length > limit) {
    throw new AppError(400, "invalid_file", `File must be between 1 byte and ${Math.floor(limit / 1_000_000)} MB.`);
  }
  const detected = detectUpload(bytes, kind);
  if (!detected) {
    throw new AppError(400, "invalid_file", kind === "image" ? "Upload a JPEG, PNG, or WebP image." : "Upload a JPEG, PNG, WebP, or PDF file.");
  }
  const storageKey = await writeStored(orgId, bytes, detected);
  return { storageKey, mimeType: detected.mimeType, sizeBytes: bytes.length };
}

async function writeStored(orgId: string, bytes: Buffer, detected: DetectedFile): Promise<string> {
  if (!/^[a-zA-Z0-9]+$/.test(orgId)) throw new AppError(400, "invalid_file", "Could not store the file.");
  const storageKey = `${orgId}/${newSecret(16)}.${detected.extension}`;
  const full = safeStoragePath(storageRoot(), storageKey);
  if (!full) throw new AppError(400, "invalid_file", "Could not store the file.");
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes, { flag: "wx" });
  return storageKey;
}

export async function readStored(storageKey: string): Promise<Buffer> {
  const full = safeStoragePath(storageRoot(), storageKey);
  if (!full) throw notFound();
  try {
    return await readFile(full);
  } catch {
    throw notFound();
  }
}

export async function removeStored(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) return;
  const full = safeStoragePath(storageRoot(), storageKey);
  if (!full) return;
  await unlink(full).catch(() => undefined);
}
