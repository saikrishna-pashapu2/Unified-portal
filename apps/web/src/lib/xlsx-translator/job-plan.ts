import { buildPlan, type WorkbookSource } from "./workbook";
import type { ExcelPayload, TranslationEntry } from "./types";

// Every confirmed addition has its own immutable IDs and request-budget keys.
// New scopes supersede older scopes only for the exact selected cells. Earlier
// accepted entries remain in the checkpoint and unrelated cells keep their IDs.
export function buildJobPlan(book: WorkbookSource, payload: ExcelPayload) {
  const scopes = [
    {
      id: "",
      selections: payload.selections || [],
      planVersion: payload.planVersion,
    },
    ...(payload.additions || []),
  ];
  const batches: TranslationEntry[][] = [];
  const batchKeys: string[] = [];
  const allEntries: TranslationEntry[] = [];
  for (const scope of scopes) {
    const plan = buildPlan(
      book,
      scope.selections,
      payload.targetLang,
      scope.planVersion === undefined,
      scope.planVersion !== 3,
    );
    for (let i = 0; i < plan.batches.length; i++) {
      const entries = plan.batches[i].map((e) => ({
        ...e,
        id: scope.id ? `${scope.id}:${e.id}` : e.id,
        cells: [...e.cells],
      }));
      batches.push(entries);
      batchKeys.push(scope.id ? `${scope.id}:${i}` : String(i));
      allEntries.push(...entries);
    }
  }
  const owners = new Map<string, string>();
  for (const e of allEntries)
    for (const cell of e.cells) owners.set(cell, e.id);
  const effective = new Map(
    allEntries.map((e) => [
      e.id,
      { ...e, cells: e.cells.filter((cell) => owners.get(cell) === e.id) },
    ]),
  );
  return {
    entries: Array.from(effective.values()).filter((e) => e.cells.length),
    batches: batches.map((batch) =>
      batch.map((e) => effective.get(e.id)!).filter((e) => e.cells.length),
    ),
    batchKeys,
  };
}
