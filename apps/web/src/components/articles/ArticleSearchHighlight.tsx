import type { ReactNode } from "react";

type ArticleSearchHighlightProps = {
  text: string | null | undefined;
  query?: string | null;
  className?: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchTerms(query: string) {
  return Array.from(
    new Set(
      query
        .trim()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  ).sort((left, right) => right.length - left.length);
}

/**
 * Highlights plain-text search matches without interpreting article content as
 * HTML. React escapes both the surrounding text and each mark automatically.
 */
export default function ArticleSearchHighlight({
  text,
  query,
  className,
}: ArticleSearchHighlightProps) {
  const value = text ?? "";
  const terms = searchTerms(query ?? "");

  if (!value || terms.length === 0) {
    return <span className={className}>{value}</span>;
  }

  const matcher = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const pieces = value.split(matcher);

  return (
    <span className={className}>
      {pieces.map((piece, index) => {
        const isMatch = terms.some((term) => piece.toLocaleLowerCase() === term.toLocaleLowerCase());
        return isMatch ? (
          <mark
            key={`${piece}-${index}`}
            className="rounded bg-emerald-100 px-0.5 text-emerald-950"
          >
            {piece}
          </mark>
        ) : (
          <span key={`${piece}-${index}`}>{piece}</span>
        );
      })}
    </span>
  );
}

export type { ArticleSearchHighlightProps };

export function highlightArticleText(
  text: string | null | undefined,
  query?: string | null,
): ReactNode {
  return <ArticleSearchHighlight text={text} query={query} />;
}
