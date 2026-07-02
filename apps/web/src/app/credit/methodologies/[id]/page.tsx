import { notFound } from "next/navigation";
import { getMethodology } from "@/lib/methodologies";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Calendar, Building2 } from "lucide-react";
import SafeHTMLContent from "@/components/SafeHTMLContent";

export default async function MethodologyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const methodology = await getMethodology(Number(id));
  if (!methodology) return notFound();

  const isFitch = methodology.source?.startsWith("Fitch");
  const isSP = methodology.source === "S&P Global";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      {/* Back Navigation */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/credit/publications?view=methodologies"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Methodologies
        </Link>
      </div>

      {/* Header */}
      <div className="space-y-4 pb-6 border-b border-border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4" />
          <span>{methodology.source}</span>
          {methodology.published_date && (
            <>
              <span>•</span>
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                <time dateTime={methodology.published_date.toISOString()}>
                  {new Date(methodology.published_date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long", 
                    day: "numeric",
                  })}
                </time>
              </div>
            </>
          )}
        </div>
        
        <h1 className="text-3xl font-bold text-foreground leading-tight">{methodology.title}</h1>
      </div>

      {/* Abstract */}
      {methodology.abstract && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-3 text-card-foreground">Abstract</h2>
          <p className="text-muted-foreground leading-relaxed">{methodology.abstract}</p>
        </div>
      )}

      {/* Main Content */}
      <div className="space-y-6">
        {isFitch ? (
          methodology.report_url ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">Report</h2>
              {/* PDF embed for Fitch documents */}
              <div className="border border-border rounded-xl overflow-hidden bg-muted/50">
                <iframe
                  src={`${methodology.report_url}#view=FitH`}
                  className="w-full h-[80vh] bg-white"
                  title="Methodology PDF"
                  loading="lazy"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                If the PDF doesn&apos;t display properly, you can{" "}
                <a 
                  href={methodology.report_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  open it directly
                </a>.
              </p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-6 text-center">
              <p className="text-sm text-muted-foreground">Report URL not available.</p>
            </div>
          )
        ) : isSP ? (
          methodology.description ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">Methodology Details</h2>
              <div className="bg-card border border-border rounded-xl p-6">
                <SafeHTMLContent 
                  htmlContent={methodology.description}
                  className="text-muted-foreground"
                />
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-6 text-center">
              <p className="text-sm text-muted-foreground">No description provided.</p>
            </div>
          )
        ) : (
          <div className="bg-card border border-border rounded-xl p-6 text-center">
            <p className="text-sm text-muted-foreground">Content format not supported for this source.</p>
          </div>
        )}
      </div>

      {/* External Links */}
      {methodology.link && (
        <div className="pt-6 border-t border-border">
          <h3 className="text-sm font-medium text-foreground mb-3">External Resources</h3>
          <a
            href={methodology.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Open original document
          </a>
        </div>
      )}
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const methodology = await getMethodology(Number(id));
  
  if (!methodology) {
    return {
      title: "Methodology Not Found",
    };
  }

  return {
    title: `${methodology.title} - Credit Methodologies`,
    description: methodology.abstract || `${methodology.source} methodology document`,
  };
}
