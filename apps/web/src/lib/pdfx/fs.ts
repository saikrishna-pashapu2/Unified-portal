import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/config/env";

const ROOT = process.cwd();
const BASE = env.PDFX_STORAGE_DIR;
export const PDFX_BASE = path.join(ROOT, BASE);
export const PDFX_UPLOADS = path.join(PDFX_BASE, "uploads");
export const PDFX_OUTPUTS = path.join(PDFX_BASE, "outputs");

export function ensureFolders() {
  [PDFX_BASE, PDFX_UPLOADS, PDFX_OUTPUTS].forEach((p) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
}

export function jobInputPath(stored: string) {
  return path.join(PDFX_UPLOADS, stored);
}
