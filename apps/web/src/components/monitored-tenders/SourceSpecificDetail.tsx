import EtsTenderDetail from "./source-details/EtsTenderDetail";
import GoszakupDetail from "./source-details/GoszakupDetail";
import MitworkDetail from "./source-details/MitworkDetail";
import NationalBankDetail from "./source-details/NationalBankDetail";
import SamrukKazynaDetail from "./source-details/SamrukKazynaDetail";
import UzexDetail from "./source-details/UzexDetail";
import XtXaridDetail from "./source-details/XtXaridDetail";
import ZakupUnifiedDetail from "./source-details/ZakupUnifiedDetail";
import type { SourceDetailProps } from "./source-details/primitives";

const SOURCE_COMPONENTS = {
  ets_tender: EtsTenderDetail,
  goszakup: GoszakupDetail,
  mitwork: MitworkDetail,
  national_bank: NationalBankDetail,
  samruk_kazyna: SamrukKazynaDetail,
  uzex_etender: UzexDetail,
  xt_xarid: XtXaridDetail,
  "xt-xarid": XtXaridDetail,
  zakup_unified: ZakupUnifiedDetail,
} as const;

type SourceComponentKey = keyof typeof SOURCE_COMPONENTS;

function normalizeSourceName(sourceName: unknown): SourceComponentKey | null {
  if (typeof sourceName !== "string") return null;
  const normalized = sourceName.trim().toLowerCase();
  return normalized in SOURCE_COMPONENTS ? (normalized as SourceComponentKey) : null;
}

export function hasSourceSpecificDetail(sourceName: unknown): boolean {
  return normalizeSourceName(sourceName) !== null;
}

export default function SourceSpecificDetail(props: SourceDetailProps) {
  const sourceKey = normalizeSourceName(props.tender.source_name);
  if (!sourceKey) return null;
  const Component = SOURCE_COMPONENTS[sourceKey];
  return <Component {...props} />;
}
