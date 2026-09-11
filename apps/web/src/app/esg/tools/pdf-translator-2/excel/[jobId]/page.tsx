import ExcelTranslationClient from "@/components/xlsx-translator/ExcelTranslationClient";
export default async function Page({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  return <ExcelTranslationClient jobId={(await params).jobId} />;
}
