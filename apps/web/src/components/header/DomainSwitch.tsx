"use client";
import { usePathname, useRouter } from "next/navigation";
import { useDomainSwitch } from "@/components/providers/DomainSwitchAnimation";

export default function DomainSwitch() {
  const pathname = usePathname();
  const router = useRouter();
  const { triggerAnimation } = useDomainSwitch();

  // Check if we're on a home page (e.g., /esg or /credit)
  const isHomePage = () => {
    const parts = pathname.split("/").filter(Boolean);
    // Home page has exactly 1 segment: the domain name
    return parts.length === 1 && (parts[0] === "esg" || parts[0] === "credit");
  };

  // replace the first segment (/esg/... or /credit/...) and keep the rest
  const go = (to: "esg" | "credit") => {
    const parts = pathname.split("/").filter(Boolean);
    
    // If on home page, trigger the animation
    if (isHomePage() && parts[0] !== to) {
      triggerAnimation(to);
      // Delay navigation to let animation play
      setTimeout(() => {
        if (parts.length === 0) return router.push(`/${to}`);
        parts[0] = to;
        router.push("/" + parts.join("/"));
      }, 1000); // Start transitioning at peak of animation
    } else {
      // Normal navigation for non-home pages
      if (parts.length === 0) return router.push(`/${to}`);
      parts[0] = to;
      router.push("/" + parts.join("/"));
    }
  };

  const isESG = pathname.startsWith("/esg");
  return (
    <div className="inline-flex rounded-full bg-white/10 backdrop-blur-sm p-1">
      <button
        onClick={() => go("esg")}
        className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200 ${
          isESG 
            ? "bg-white text-emerald-700 shadow-sm" 
            : "text-white/70 hover:text-white hover:bg-white/10"
        }`}
      >
        ESG
      </button>
      <button
        onClick={() => go("credit")}
        className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200 ${
          !isESG 
            ? "bg-white text-slate-700 shadow-sm" 
            : "text-white/70 hover:text-white hover:bg-white/10"
        }`}
      >
        Credit
      </button>
    </div>
  );
}