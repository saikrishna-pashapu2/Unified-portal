import Link from "next/link";
import DomainSwitch from "./DomainSwitch";
import UserMenu from "./UserMenu";
import { Home, Newspaper, CalendarDays, BookOpen, Wrench, Leaf, TrendingUp, FileCheck } from "lucide-react";

export default function Header({ domain }: { domain: "esg" | "credit" }) {
  const base = `/${domain}`;
  const isESG = domain === "esg";
  
  const navItems = [
    { href: base, label: "Home", icon: Home },
    { href: `${base}/articles`, label: "Articles", icon: Newspaper },
    { href: `${base}/events`, label: "Events", icon: CalendarDays },
    { href: `${base}/tenders`, label: "Tenders", icon: FileCheck },
    { href: `${base}/publications`, label: "Publications", icon: BookOpen },
    { href: `${base}/tools`, label: "Tools", icon: Wrench },
  ];
  
  return (
    <header className={`sticky top-0 z-50 ${isESG ? 'bg-gradient-to-r from-emerald-600 to-teal-600' : 'bg-gradient-to-r from-slate-700 to-slate-800'}`}>
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 h-16">
        {/* Logo */}
        <Link href={base} className="flex items-center gap-3 group">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isESG ? 'bg-white/20' : 'bg-white/10'} backdrop-blur-sm transition-transform group-hover:scale-105`}>
            {isESG ? (
              <Leaf className="h-5 w-5 text-white" />
            ) : (
              <TrendingUp className="h-5 w-5 text-white" />
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold text-white tracking-tight">
              {isESG ? 'ESG' : 'Credit Rating'}
            </span>
            <span className="text-[10px] text-white/70 font-medium tracking-wider uppercase">
              {isESG ? 'Sustainability Insights' : 'Rating Analytics'}
            </span>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition-all duration-200"
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          <DomainSwitch />
          <UserMenu domain={domain} />
        </div>
      </div>
    </header>
  );
}
