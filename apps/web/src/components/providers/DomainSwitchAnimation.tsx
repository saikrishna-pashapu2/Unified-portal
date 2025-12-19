"use client";
import { createContext, useContext, useState, useEffect } from "react";

type DomainSwitchContextType = {
  triggerAnimation: (targetDomain: "esg" | "credit") => void;
};

const DomainSwitchContext = createContext<DomainSwitchContextType | null>(null);

export function useDomainSwitch() {
  const ctx = useContext(DomainSwitchContext);
  if (!ctx) throw new Error("useDomainSwitch must be used within DomainSwitchProvider");
  return ctx;
}

export function DomainSwitchProvider({ children }: { children: React.ReactNode }) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [targetDomain, setTargetDomain] = useState<"esg" | "credit" | null>(null);

  const triggerAnimation = (domain: "esg" | "credit") => {
    setTargetDomain(domain);
    setIsAnimating(true);
    
    setTimeout(() => {
      setIsAnimating(false);
      setTargetDomain(null);
    }, 1200);
  };

  useEffect(() => {
    if (isAnimating) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  }, [isAnimating]);

  return (
    <DomainSwitchContext.Provider value={{ triggerAnimation }}>
      {children}
      {isAnimating && targetDomain && <DomainSwitchAnimation domain={targetDomain} />}
    </DomainSwitchContext.Provider>
  );
}

function DomainSwitchAnimation({ domain }: { domain: "esg" | "credit" }) {
  const isESG = domain === "esg";
  
  const colors = isESG 
    ? { primary: "#10b981", secondary: "#14b8a6", bg: "from-emerald-600 to-teal-600" }
    : { primary: "#3b82f6", secondary: "#6366f1", bg: "from-slate-700 to-slate-800" };

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none overflow-hidden">
      {/* Clean gradient background */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${colors.bg}`}
        style={{ animation: "fade-through 1.2s ease-in-out forwards" }}
      />

      {/* Subtle animated circles */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="absolute w-64 h-64 rounded-full opacity-20"
          style={{
            background: `radial-gradient(circle, white 0%, transparent 70%)`,
            animation: "pulse-ring 1.2s ease-out forwards",
          }}
        />
      </div>

      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          {/* Icon */}
          <div
            className="mb-4"
            style={{ animation: "pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" }}
          >
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm">
              {isESG ? (
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              ) : (
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              )}
            </div>
          </div>

          {/* Text */}
          <h1
            className="text-5xl md:text-6xl font-bold text-white mb-2"
            style={{ animation: "slide-up 0.6s ease-out 0.1s forwards", opacity: 0 }}
          >
            {isESG ? "ESG" : "Credit"}
          </h1>
          
          <p
            className="text-xl text-white/80 font-medium tracking-wide"
            style={{ animation: "slide-up 0.6s ease-out 0.2s forwards", opacity: 0 }}
          >
            {isESG ? "Sustainability Insights" : "Rating Analytics"}
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-through {
          0% { opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes pulse-ring {
          0% { transform: scale(0.5); opacity: 0; }
          50% { opacity: 0.3; }
          100% { transform: scale(3); opacity: 0; }
        }

        @keyframes pop-in {
          0% { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        @keyframes slide-up {
          0% { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
