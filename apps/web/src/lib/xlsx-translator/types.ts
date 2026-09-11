export const XLSX_JOB_TYPE = "xlsx_translation_v1" as const;
export type DetectedLanguage =
  | "Uzbek"
  | "Russian"
  | "English"
  | "Arabic"
  | "Unknown";
export type Selection = {
  sheet: string;
  range: string;
  columns?: number[];
  sourceLanguage?: DetectedLanguage | "Auto";
};
export type CellView = {
  address: string;
  row: number;
  col: number;
  text: string;
  formula: boolean;
  language: DetectedLanguage;
  protection?: string;
  style: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    fill?: string;
    fontSize?: number;
    align?: string;
    wrap?: boolean;
    border?: boolean;
  };
};
export type TableView = {
  id: string;
  label: string;
  range: string;
  kind: "table" | "detected";
  rows: number;
  columns: number;
  languages: Partial<Record<DetectedLanguage, number>>;
  preview: CellView[];
};
export type SheetView = {
  name: string;
  hidden: boolean;
  range: string;
  tables: TableView[];
  formulaCount: number;
  mergeCount: number;
  protectedCount: number;
};
export type Inspection = {
  sheets: SheetView[];
  warnings: string[];
  sheetCount: number;
  formulaCount: number;
  mergeCount: number;
};
export type TranslationEntry = {
  id: string;
  source: string;
  context: string;
  language: DetectedLanguage | "Auto";
  cells: string[];
};
export type TranslationPlan = {
  entries: TranslationEntry[];
  selectedCells: number;
  protectedCells: number;
  characters: number;
  batches: TranslationEntry[][];
};
export type ExcelPayload = {
  filename: string;
  targetLang: string;
  selections?: Selection[];
  planHash?: string;
  // Missing: legacy formula protection; 2: values-only; 3: updated language
  // detection. Replay each paid scope with the rules used at confirmation.
  planVersion?: 2 | 3;
  additions?: {
    id: string;
    selections: Selection[];
    planHash: string;
    planVersion?: 2 | 3;
  }[];
};
export type ExcelCheckpoint = {
  version: 1;
  translations: Record<string, string>;
  attempts: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  requests: number;
  completedBatches: number;
  totalBatches: number;
  translatedCells: number;
  // Cell IDs + fixed validation messages only, not raw provider responses.
  batchIssues?: Record<string, { id: string; reason: string }[]>;
  lastRequestFailure?: "request_failed" | "unreadable_response";
  rejectedCells?: Record<
    string,
    { text: string; sourceLanguage: string; action: "translated" | "preserved" }
  >;
  // One explicitly confirmed recovery may grant a third request only to
  // batches already exhausted at confirmation. Original counters never reset.
  recoveryGranted?: string[];
  recoveryApproved?: boolean;
  recoveryForAddition?: string;
};
export type ExcelJobView = {
  id: string;
  filename: string;
  targetLang: string;
  status: string;
  progress: number;
  message: string;
  createdAt: string;
  canDownload: boolean;
  hasTranslation: boolean;
  canRestoreDraft: boolean;
  canReviewRecovery?: boolean;
  canRecheckSaved?: boolean;
  canExtend?: boolean;
  usage: Omit<
    ExcelCheckpoint,
    | "translations"
    | "attempts"
    | "batchIssues"
    | "lastRequestFailure"
    | "rejectedCells"
    | "recoveryGranted"
    | "recoveryApproved"
    | "recoveryForAddition"
  > | null;
};
