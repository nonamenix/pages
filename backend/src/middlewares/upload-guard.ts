import { open } from "node:fs/promises";
import path from "node:path";

type UploadFile = {
  filepath?: string;
  path?: string;
  originalFilename?: string;
  name?: string;
  mimetype?: string;
  type?: string;
  size?: number;
};

type GuardConfig = {
  maxBytes: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
};

const flattenFiles = (value: unknown): UploadFile[] => {
  if (Array.isArray(value)) return value.flatMap(flattenFiles);
  if (!value || typeof value !== "object") return [];
  const candidate = value as UploadFile;
  if (candidate.filepath || candidate.path) return [candidate];
  return Object.values(value as Record<string, unknown>).flatMap(flattenFiles);
};

const detectedMime = (header: Buffer) => {
  if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (header.subarray(4, 8).toString("ascii") === "ftyp" && /avif|avis/.test(header.subarray(8, 32).toString("ascii"))) return "image/avif";
  return null;
};

const inspectFile = async (file: UploadFile, config: GuardConfig) => {
  const filename = String(file.originalFilename || file.name || "");
  const extension = path.extname(filename).toLowerCase();
  const mime = String(file.mimetype || file.type || "").toLowerCase();
  const filepath = String(file.filepath || file.path || "");

  if (!filepath || !config.allowedExtensions.includes(extension) || !config.allowedMimeTypes.includes(mime)) return "type";
  if (!Number.isFinite(file.size) || Number(file.size) <= 0 || Number(file.size) > config.maxBytes) return "size";

  const handle = await open(filepath, "r");
  try {
    const header = Buffer.alloc(32);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return detectedMime(header.subarray(0, bytesRead)) === mime ? null : "signature";
  } finally {
    await handle.close();
  }
};

export default (config: GuardConfig) => async (ctx: any, next: () => Promise<void>) => {
  if (!["POST", "PUT"].includes(ctx.method) || !ctx.path.startsWith("/upload")) return next();

  for (const file of flattenFiles(ctx.request.files)) {
    const reason = await inspectFile(file, config);
    if (!reason) continue;
    ctx.status = reason === "size" ? 413 : 415;
    ctx.body = {
      data: null,
      error: {
        status: ctx.status,
        name: reason === "size" ? "PayloadTooLargeError" : "UnsupportedMediaTypeError",
        message: "Файл не соответствует требованиям безопасности",
      },
    };
    return;
  }

  await next();
};
