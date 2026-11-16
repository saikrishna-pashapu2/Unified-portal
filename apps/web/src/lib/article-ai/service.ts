import "server-only";

// Keep the route/weekly-email import stable while the implementation lives in
// the shared-assessment service. Legacy per-user recommendation rows are not
// exposed by these exports; jobs.ts owns the separate pending Credit migration
// reconciliation for rows created before the domain-assessment cutover.
export {
  getArticleAiPreferenceV2 as getArticleAiPreference,
  setArticleAiPreferenceV2 as setArticleAiPreference,
  getArticleAiSelectionsV2 as getArticleAiSelections,
  recordArticleAiFeedbackV2 as recordArticleAiFeedback,
  getArticleAiDigestPicksV2 as getArticleAiDigestPicks,
  filterArticleAiDigestPicksForCommitV2 as filterArticleAiDigestPicksForCommit,
  reconcileDomainArticleAiFeedbackV2 as reconcileDomainArticleAiFeedback,
} from "./service-v2";
