"use client";

import { useEffect, useState } from "react";
import DOMPurify from "isomorphic-dompurify";

interface SafeHTMLContentProps {
  htmlContent: string;
  className?: string;
}

export default function SafeHTMLContent({ htmlContent, className = "" }: SafeHTMLContentProps) {
  const [sanitizedHTML, setSanitizedHTML] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const cleaned = DOMPurify.sanitize(htmlContent, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
      FORBID_ATTR: ["style"],
    });
    setSanitizedHTML(cleaned);
    setIsLoading(false);
  }, [htmlContent]);

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-muted rounded w-1/2 mb-2"></div>
          <div className="h-4 bg-muted rounded w-5/6"></div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-a:text-primary prose-strong:text-foreground prose-ul:text-muted-foreground prose-ol:text-muted-foreground prose-li:text-muted-foreground ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizedHTML }}
    />
  );
}
