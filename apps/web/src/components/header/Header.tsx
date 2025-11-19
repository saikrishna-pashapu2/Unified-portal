import Link from "next/link";
import DomainSwitch from "./DomainSwitch";
import UserMenu from "./UserMenu";
import { Home, Newspaper, CalendarCheck, BookOpen, Search, BarChart3 } from "lucide-react";

const NavLink = ({ href, children, active = false }: { href: string; children: React.ReactNode; active?: boolean }) => (
  <Link 
    href={href} 
    className={`
      relative rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-[var(--surface-2)] focus-ring
      ${active ? 'text-[var(--brand)] bg-[var(--surface-2)]' : 'text-[var(--text)]'}
      before:absolute before:bottom-0 before:left-1/2 before:h-0.5 before:w-0 before:bg-[var(--brand)] before:transition-all before:duration-200
      hover:before:w-full hover:before:left-0
    `}
  >
    {children}
  </Link>
);

export default function Header({ domain }: { domain: "esg" | "credit" }) {
  const base = `/${domain}`;
  
  return (
    <header className="glass sticky top-0 z-50 border-b border-[var(--border)]">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
        {/* Logo */}
        <Link href={base} className="flex items-center gap-3 focus-ring rounded-lg px-2 py-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] text-white">
            <span className="text-sm font-bold">{domain.charAt(0).toUpperCase()}</span>
          </div>
          <span className="text-lg font-bold tracking-tight text-[var(--text)]">
            {domain.toUpperCase()} Portal
          </span>
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-2">
          <NavLink href={base}>
            <span className="inline-flex items-center gap-2">
              <Home size={16} />
              Home
            </span>
          </NavLink>
          <NavLink href={`${base}/articles`}>
            <span className="inline-flex items-center gap-2">
              <Newspaper size={16} />
              Articles
            </span>
          </NavLink>
          <NavLink href={`${base}/events`}>
            <span className="inline-flex items-center gap-2">
              <CalendarCheck size={16} />
              Events
            </span>
          </NavLink>
          <NavLink href={`${base}/publications`}>
            <span className="inline-flex items-center gap-2">
              <BookOpen size={16} />
              Publications
            </span>
          </NavLink>
          <NavLink href={`${base}/tools`}>
            <span className="inline-flex items-center gap-2">
              <BarChart3 size={16} />
              Tools
            </span>
          </NavLink>
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Search Button */}
          <button className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--text)] focus-ring">
            <Search size={16} />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline-flex h-5 w-auto min-w-[1.25rem] items-center justify-center rounded border border-[var(--border-muted)] bg-[var(--surface-2)] px-1 text-[10px] font-medium text-[var(--text-subtle)]">
              ⌘K
            </kbd>
          </button>
          
          <DomainSwitch />
          <UserMenu domain={domain} />
        </div>
      </div>
    </header>
  );
}