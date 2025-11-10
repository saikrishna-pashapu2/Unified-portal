"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const itemsByDomain = {
  esg: [
    { href: "/esg", label: "Home" },
    { href: "/esg/articles", label: "Articles" },
    { href: "/esg/events", label: "Events" },
    { href: "/esg/tenders", label: "Tenders" },
    { href: "/esg/publications", label: "Publications" },
    { href: "/esg/scores", label: "Scores Tool" },
    { href: "/esg/pdf-translate", label: "PDF Translate" },
  ],
  credit: [
    { href: "/credit", label: "Home" },
    { href: "/credit/articles", label: "Articles" },
    { href: "/credit/events", label: "Events" },
    { href: "/credit/tenders", label: "Tenders" },
    { href: "/credit/publications", label: "Publications" },
    { href: "/credit/tools/fitch", label: "Fitch Tool" },
  ],
} as const;

export default function DomainNav({ domain }: { domain: "esg" | "credit" }) {
  const pathname = usePathname();
  const items = itemsByDomain[domain];
  return (
    <nav className="flex flex-wrap gap-2">
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`rounded-lg px-3 py-1.5 text-sm border ${
              active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent/10 border-border"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}