"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

// Force dynamic rendering - this page uses searchParams
export const dynamic = 'force-dynamic';

export default function PreviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId");
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);

  useEffect(() => {
    if (!jobId) {
      setError("No job ID provided");
      setLoading(false);
      return;
    }

    async function loadPreview() {
      try {
        const res = await fetch(`/api/fitch/preview?jobId=${jobId}`);
        if (!res.ok) throw new Error("Failed to load preview");
        const json = await res.json();
        setData(json);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    loadPreview();
  }, [jobId]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <Card>
          <CardContent className="p-8">
            <div className="text-center text-muted-foreground">Loading preview...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <Card>
          <CardContent className="p-8">
            <div className="text-center text-destructive">{error}</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const headers = data?.data?.[0] || [];
  const rows = data?.data?.slice(1) || [];

  // Find indices for Company and Rating Code columns
  const companyIndex = headers.findIndex((h: string) => 
    h && (h.toLowerCase() === 'company' || h.toLowerCase() === 'company name')
  );
  const ratingCodeIndex = headers.findIndex((h: string) => 
    h && h.toLowerCase() === 'rating code'
  );

  // Filter to only show these two columns
  const filteredHeaders = [
    companyIndex >= 0 ? headers[companyIndex] : 'Company',
    ratingCodeIndex >= 0 ? headers[ratingCodeIndex] : 'Rating Code'
  ];

  const filteredRows = rows.map((row: any[]) => [
    companyIndex >= 0 ? row[companyIndex] : '-',
    ratingCodeIndex >= 0 ? row[ratingCodeIndex] : '-'
  ]);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{data?.filename}</h1>
              <p className="text-sm text-muted-foreground">Sheet: {data?.sheetName}</p>
            </div>
          </div>
          <a
            href={`/api/fitch/download?jobId=${jobId}`}
            className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            Download Excel
          </a>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Preview ({filteredRows.length} rows)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[600px]">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-muted/50 z-10">
                  <tr className="border-b border-border">
                    {filteredHeaders.map((header: any, i: number) => (
                      <th key={i} className="px-4 py-3 text-left font-medium whitespace-nowrap border-r border-border last:border-r-0">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row: any[], rowIndex: number) => (
                    <tr key={rowIndex} className="border-b border-border hover:bg-muted/30">
                      {row.map((cell: any, cellIndex: number) => (
                        <td key={cellIndex} className="px-4 py-2 whitespace-nowrap border-r border-border last:border-r-0">
                          {cell || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
