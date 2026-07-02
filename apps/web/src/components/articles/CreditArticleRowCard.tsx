import Link from "next/link";
import { CalendarDays, ExternalLink, MapPin, Newspaper, Tag } from "lucide-react";
import LikeButton from "@/components/LikeButton";
import { parseKeywords } from "@/lib/keywords";

type CreditArticleRowCardProps = {
  title: string;
  detailHref: string;
  externalHref?: string | null;
  source: string | null;
  dateLabel: string;
  regionLabel: string;
  sectorLabel: string;
  matchedKeywords?: string | null;
  // Like system props
  articleId?: number;
  initialLiked?: boolean;
  initialLikeCount?: number;
};

export default function CreditArticleRowCard({
  title,
  detailHref,
  externalHref,
  source,
  dateLabel,
  regionLabel,
  sectorLabel,
  matchedKeywords,
  articleId,
  initialLiked = false,
  initialLikeCount = 0,
}: CreditArticleRowCardProps) {
  const keywords = parseKeywords(matchedKeywords);

  return (
    <article className="w-full rounded-2xl border border-border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-col gap-6 px-5 py-6 md:flex-row md:items-center md:justify-between">
        <div className="flex-1 space-y-3">
          <h2 className="text-lg font-semibold leading-snug">
            <Link href={detailHref} className="hover:underline">
              {title}
            </Link>
          </h2>

          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Newspaper className="h-4 w-4" aria-hidden="true" />
              {source ?? "Unknown source"}
            </span>
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {dateLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {regionLabel}
            </span>
            <span className="rounded-full bg-muted px-3 py-1">{sectorLabel}</span>
            {keywords.map((keyword) => (
              <span key={keyword} className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1" title={keyword}>
                <Tag className="h-3 w-3" aria-hidden="true" />
                <span className="truncate max-w-[150px]">{keyword}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Like button */}
          {articleId && (
            <LikeButton
              domain="credit"
              contentId={articleId}
              initialLiked={initialLiked}
              initialCount={initialLikeCount}
            />
          )}

          {/* External link */}
          {externalHref ? (
            <a
              href={externalHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 self-start rounded-lg border border-primary bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 md:self-center"
            >
              Open source
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
