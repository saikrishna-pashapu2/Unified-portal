import "server-only";

import { Worker } from "node:worker_threads";

export type WorkbookCell = string | number | boolean | null;
export type WorkbookRows = WorkbookCell[][];

export type WorkbookSheetInput = {
  name: string;
  rows: WorkbookRows;
  columnWidths?: number[];
  autoFilter?: string;
  freezeRows?: number;
};

export type ParsedWorkbook = {
  sheetName: string;
  rows: WorkbookRows;
};

export const MAX_WORKBOOK_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_WORKBOOK_DATA_ROWS = 500;
export const MAX_WORKBOOK_COLUMNS = 128;
export const MAX_WORKBOOK_SHEETS = 5;
export const MAX_WORKBOOK_CELL_CHARS = 20_000;
export const MAX_WORKBOOK_TOTAL_CELLS = 100_000;
export const MAX_WORKBOOK_TOTAL_TEXT_CHARS = 2_000_000;
export const WORKBOOK_PARSE_TIMEOUT_MS = 10_000;
export const WORKBOOK_JOB_TIMEOUT_MS = 5 * 60 * 1000;
export const MAX_CONCURRENT_WORKBOOK_WORKERS = boundedEnvInteger(
  process.env.WORKBOOK_WORKER_CONCURRENCY,
  2,
  1,
  4,
);
export const MAX_QUEUED_WORKBOOK_WORKERS = boundedEnvInteger(
  process.env.WORKBOOK_WORKER_QUEUE_LIMIT,
  8,
  0,
  32,
);
const WORKBOOK_WORKER_QUEUE_TIMEOUT_MS = 5_000;

let activeWorkbookWorkers = 0;
const workbookWorkerWaiters: Array<() => void> = [];

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ALLOWED_WORKBOOK_TYPES = new Set([
  "",
  "application/octet-stream",
  XLSX_CONTENT_TYPE,
]);

type WorkbookLimits = {
  maxCellChars: number;
  maxColumns: number;
  maxRows: number;
  maxSheets: number;
  maxTotalCells: number;
  maxTotalTextChars: number;
};

type WorkerSuccess = {
  ok: true;
  result: ParsedWorkbook | Uint8Array;
};

type WorkerFailure = {
  ok: false;
  error: string;
};

export class WorkbookSecurityError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "WorkbookSecurityError";
  }
}

export function validateWorkbookRequestSize(request: Request): void {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) return;

  const contentLength = Number(rawLength);
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_WORKBOOK_UPLOAD_BYTES + 1024 * 1024
  ) {
    throw new WorkbookSecurityError("Workbook request is too large", 413);
  }
}

export function validateWorkbookFile(file: File): void {
  if (file.size <= 0) {
    throw new WorkbookSecurityError("Workbook is empty");
  }
  if (file.size > MAX_WORKBOOK_UPLOAD_BYTES) {
    throw new WorkbookSecurityError("Workbook exceeds the 5 MiB limit", 413);
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new WorkbookSecurityError("Only .xlsx workbooks are accepted");
  }
  if (!ALLOWED_WORKBOOK_TYPES.has(file.type.toLowerCase())) {
    throw new WorkbookSecurityError("Invalid workbook content type");
  }
}

export function validateWorkbookMagic(buffer: Buffer): void {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    throw new WorkbookSecurityError("Invalid XLSX file signature");
  }
}

export async function parseWorkbookBuffer(buffer: Buffer): Promise<ParsedWorkbook> {
  if (buffer.length > MAX_WORKBOOK_UPLOAD_BYTES) {
    throw new WorkbookSecurityError("Workbook exceeds the 5 MiB limit", 413);
  }
  validateWorkbookMagic(buffer);

  const bytes = Uint8Array.from(buffer);
  const result = await runWorkbookWorker(
    {
      task: "parse",
      bytes,
      limits: inputLimits(),
      modulePath: require.resolve("xlsx"),
    },
    [bytes.buffer],
  );

  return result as ParsedWorkbook;
}

export async function writeWorkbookBuffer(
  sheets: WorkbookSheetInput[],
): Promise<Buffer> {
  if (sheets.length < 1 || sheets.length > MAX_WORKBOOK_SHEETS) {
    throw new WorkbookSecurityError(
      `Workbook must contain between 1 and ${MAX_WORKBOOK_SHEETS} sheets`,
    );
  }

  const result = await runWorkbookWorker({
    task: "write",
    sheets: sheets.map((sheet, index) => ({
      ...sheet,
      name: normalizeSheetName(sheet.name, index),
    })),
    limits: outputLimits(),
    modulePath: require.resolve("xlsx"),
  });

  return Buffer.from(result as Uint8Array);
}

export function workbookErrorResponse(error: unknown): {
  message: string;
  status: number;
} {
  if (error instanceof WorkbookSecurityError) {
    return { message: error.message, status: error.status };
  }
  return { message: "Workbook processing failed", status: 400 };
}

export function assertWorkbookJobWithinDeadline(deadline: number): void {
  if (Date.now() > deadline) {
    throw new WorkbookSecurityError("Workbook processing time limit exceeded", 408);
  }
}

function inputLimits(): WorkbookLimits {
  return {
    maxCellChars: MAX_WORKBOOK_CELL_CHARS,
    maxColumns: MAX_WORKBOOK_COLUMNS,
    maxRows: MAX_WORKBOOK_DATA_ROWS + 1,
    maxSheets: MAX_WORKBOOK_SHEETS,
    maxTotalCells: MAX_WORKBOOK_TOTAL_CELLS,
    maxTotalTextChars: MAX_WORKBOOK_TOTAL_TEXT_CHARS,
  };
}

function outputLimits(): WorkbookLimits {
  return {
    ...inputLimits(),
    maxRows: 2_000,
    maxTotalCells: 250_000,
    maxTotalTextChars: 5_000_000,
  };
}

function normalizeSheetName(name: string, index: number): string {
  const normalized = name.replace(/[\\/?*:[\]]/g, " ").trim().slice(0, 31);
  return normalized || `Sheet${index + 1}`;
}

async function runWorkbookWorker(
  workerData: Record<string, unknown>,
  transferList: ArrayBuffer[] = [],
): Promise<ParsedWorkbook | Uint8Array> {
  const release = await acquireWorkbookWorkerSlot();
  try {
    return await runIsolatedWorkbookWorker(workerData, transferList);
  } finally {
    release();
  }
}

function runIsolatedWorkbookWorker(
  workerData: Record<string, unknown>,
  transferList: ArrayBuffer[] = [],
): Promise<ParsedWorkbook | Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
      transferList,
      workerData,
    });
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
      void worker.terminate();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new WorkbookSecurityError("Workbook parser timed out", 408)),
      );
    }, WORKBOOK_PARSE_TIMEOUT_MS);

    worker.once("message", (message: WorkerSuccess | WorkerFailure) => {
      finish(() => {
        if (message.ok) resolve(message.result);
        else reject(new WorkbookSecurityError(message.error));
      });
    });
    worker.once("error", (error) => {
      finish(() => reject(new WorkbookSecurityError(error.message)));
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(() =>
          reject(new WorkbookSecurityError("Workbook worker exited unexpectedly")),
        );
      }
    });
  });
}

function acquireWorkbookWorkerSlot(): Promise<() => void> {
  if (activeWorkbookWorkers < MAX_CONCURRENT_WORKBOOK_WORKERS) {
    activeWorkbookWorkers += 1;
    return Promise.resolve(releaseWorkbookWorkerSlot);
  }
  if (workbookWorkerWaiters.length >= MAX_QUEUED_WORKBOOK_WORKERS) {
    throw new WorkbookSecurityError("Workbook service is busy; retry shortly", 503);
  }

  return new Promise((resolve, reject) => {
    let waiter: (() => void) | null = () => {
      if (!waiter) return;
      clearTimeout(timer);
      waiter = null;
      activeWorkbookWorkers += 1;
      resolve(releaseWorkbookWorkerSlot);
    };
    const timer = setTimeout(() => {
      if (!waiter) return;
      const index = workbookWorkerWaiters.indexOf(waiter);
      if (index >= 0) workbookWorkerWaiters.splice(index, 1);
      waiter = null;
      reject(new WorkbookSecurityError("Workbook service is busy; retry shortly", 503));
    }, WORKBOOK_WORKER_QUEUE_TIMEOUT_MS);
    workbookWorkerWaiters.push(waiter);
  });
}

function releaseWorkbookWorkerSlot(): void {
  activeWorkbookWorkers = Math.max(0, activeWorkbookWorkers - 1);
  workbookWorkerWaiters.shift()?.();
}

function boundedEnvInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed)
    ? Math.max(minimum, Math.min(parsed, maximum))
    : fallback;
}

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const XLSX = require(workerData.modulePath);

function fail(message) {
  throw new Error(message);
}

function normalizeCell(value, limits, totals) {
  let normalized = value;
  if (value == null) normalized = "";
  else if (value instanceof Date) normalized = value.toISOString();
  else if (!["string", "number", "boolean"].includes(typeof value)) {
    normalized = String(value);
  }

  const text = typeof normalized === "string" ? normalized : String(normalized);
  if (text.length > limits.maxCellChars) fail("Workbook cell text is too large");
  totals.cells += 1;
  totals.text += text.length;
  if (totals.cells > limits.maxTotalCells) fail("Workbook contains too many cells");
  if (totals.text > limits.maxTotalTextChars) fail("Workbook contains too much text");
  return normalized;
}

function validateRows(rows, limits, totals) {
  if (rows.length > limits.maxRows) fail("Workbook contains too many rows");
  return rows.map((row) => {
    const values = Array.isArray(row) ? row : [];
    if (values.length > limits.maxColumns) fail("Workbook contains too many columns");
    return values.map((value) => normalizeCell(value, limits, totals));
  });
}

function parseWorkbook() {
  const limits = workerData.limits;
  const workbook = XLSX.read(Buffer.from(workerData.bytes), {
    type: "buffer",
    dense: true,
    sheetRows: limits.maxRows + 1,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    cellDates: false,
    bookVBA: false,
  });

  if (!workbook.SheetNames.length) fail("Workbook has no worksheets");
  if (workbook.SheetNames.length > limits.maxSheets) fail("Workbook contains too many sheets");

  const totals = { cells: 0, text: 0 };
  let firstRows = [];
  workbook.SheetNames.forEach((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    const fullRef = sheet["!fullref"] || sheet["!ref"];
    if (fullRef) {
      const range = XLSX.utils.decode_range(fullRef);
      if (range.e.r - range.s.r + 1 > limits.maxRows) fail("Workbook contains too many rows");
      if (range.e.c - range.s.c + 1 > limits.maxColumns) fail("Workbook contains too many columns");
    }

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true,
      blankrows: true,
    });
    const normalized = validateRows(rows, limits, totals);
    if (index === 0) firstRows = normalized;
  });

  return { sheetName: workbook.SheetNames[0], rows: firstRows };
}

function writeWorkbook() {
  const limits = workerData.limits;
  const totals = { cells: 0, text: 0 };
  const workbook = XLSX.utils.book_new();

  workerData.sheets.forEach((input) => {
    const rows = validateRows(input.rows, limits, totals);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    if (Array.isArray(input.columnWidths)) {
      sheet["!cols"] = input.columnWidths.map((wch) => ({ wch }));
    }
    if (input.autoFilter) sheet["!autofilter"] = { ref: input.autoFilter };
    if (input.freezeRows) sheet["!freeze"] = { xSplit: 0, ySplit: input.freezeRows };
    XLSX.utils.book_append_sheet(workbook, sheet, input.name);
  });

  return Uint8Array.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

try {
  const result = workerData.task === "parse" ? parseWorkbook() : writeWorkbook();
  const transfer = result instanceof Uint8Array ? [result.buffer] : [];
  parentPort.postMessage({ ok: true, result }, transfer);
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : "Workbook processing failed",
  });
}
`;
