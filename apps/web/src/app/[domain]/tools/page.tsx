import Link from "next/link";
import { 
  Search, 
  FileSpreadsheet, 
  FileText, 
  Building2, 
  LayoutDashboard,
  Menu,
  X,
  ChevronRight,
  FileCheck
} from "lucide-react";
import { cn } from "@/lib/utils";

// Import Tool Components
import EsgSearch from "./search";
import EsgExcel from "./excel";
import FitchTool from "@/app/credit/tools/fitch/ui";
import PdfxHome from "@/app/[domain]/pdfx/page";
import TendersTool from "./tenders-tool";

// Tool Configuration Types
type ToolId = "overview" | "search" | "excel" | "pdfx" | "fitch" | "tenders";

interface ToolConfig {
  id: ToolId;
  label: string;
  icon: any;
  component: React.ComponentType<any>;
  description?: string;
}

// Domain-specific Tool Configurations
const TOOLS: Record<"esg" | "credit", ToolConfig[]> = {
  esg: [
    { 
      id: "overview", 
      label: "Overview", 
      icon: LayoutDashboard, 
      component: () => null, // Placeholder
      description: "Dashboard of all available ESG tools"
    },
    { 
      id: "search", 
      label: "ESG Search", 
      icon: Search, 
      component: EsgSearch,
      description: "Search for individual company ESG scores"
    },
    { 
      id: "excel", 
      label: "Excel Updater", 
      icon: FileSpreadsheet, 
      component: EsgExcel,
      description: "Bulk update ESG data via Excel"
    },
    { 
      id: "pdfx", 
      label: "PDF Translator", 
      icon: FileText, 
      component: PdfxHome,
      description: "Translate and analyze PDF documents"
    },
    {
      id: "tenders",
      label: "Tenders",
      icon: FileCheck,
      component: TendersTool,
      description: "Browse government tenders related to ESG"
    }
  ],
  credit: [
    { 
      id: "overview", 
      label: "Overview", 
      icon: LayoutDashboard, 
      component: () => null,
      description: "Dashboard of all available Credit tools"
    },
    { 
      id: "fitch", 
      label: "Fitch Ratings", 
      icon: Building2, 
      component: FitchTool,
      description: "Fitch ratings search and analysis"
    },
    {
      id: "tenders",
      label: "Tenders",
      icon: FileCheck,
      component: TendersTool,
      description: "Explore credit-related tenders"
    }
  ]
};

export default async function ToolsPage({ 
  params, 
  searchParams 
}: { 
  params: { domain: "esg" | "credit" };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const domainTools = TOOLS[params.domain] || TOOLS.esg;
  const activeToolId = (searchParams.tool as ToolId) || "overview";
  
  // Validate activeToolId
  const activeTool = domainTools.find(t => t.id === activeToolId) || domainTools[0];
  const ActiveComponent = activeTool.component;

  return (
    <div className="flex min-h-[calc(100vh-65px)] bg-slate-50">
      {/* Sidebar */}
      <aside className="hidden lg:block w-64 bg-white border-r border-slate-200 overflow-y-auto sticky top-[65px] h-[calc(100vh-65px)]">
        <div className="h-full flex flex-col">
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">
                {params.domain === "esg" ? "ESG" : "CR"}
              </span>
              Tools
            </h2>
          </div>

          <nav className="flex-1 p-4 space-y-1">
            {domainTools.map((tool) => {
              const Icon = tool.icon;
              const isActive = activeToolId === tool.id;
              const href = tool.id === "overview" 
                ? `/${params.domain}/tools` 
                : `/${params.domain}/tools?tool=${tool.id}`;
              
              return (
                <Link
                  key={tool.id}
                  href={href}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                    isActive 
                      ? "bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200" 
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <Icon className={cn("w-5 h-5", isActive ? "text-blue-600" : "text-slate-400")} />
                  {tool.label}
                  {isActive && <ChevronRight className="w-4 h-4 ml-auto text-blue-400" />}
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t border-slate-100">
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs text-slate-500 text-center">
                Need help? <a href="#" className="text-blue-600 hover:underline">Contact Support</a>
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header - Simplified for Server Component */}
        <div className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200">
          <span className="font-semibold text-slate-800">
            {activeTool.label}
          </span>
          {/* Mobile menu trigger would require client component wrapper or just simple links */}
        </div>

        <div className="p-4 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {activeToolId === "overview" ? (
              <div className="space-y-8">
                <div className="text-center max-w-2xl mx-auto mb-12">
                  <h1 className="text-3xl font-bold text-slate-900 mb-4">
                    {params.domain === "esg" ? "ESG Intelligence Tools" : "Credit Analysis Tools"}
                  </h1>
                  <p className="text-lg text-slate-600">
                    Select a tool from the sidebar to get started with your analysis and data processing.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {domainTools.filter(t => t.id !== "overview").map((tool) => {
                    const Icon = tool.icon;
                    const href = `/${params.domain}/tools?tool=${tool.id}`;
                    return (
                      <Link
                        key={tool.id}
                        href={href}
                        className="flex flex-col items-start p-6 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-200 transition-all duration-200 group text-left"
                      >
                        <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mb-4 group-hover:bg-blue-100 transition-colors">
                          <Icon className="w-6 h-6 text-blue-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-slate-900 mb-2 group-hover:text-blue-700 transition-colors">
                          {tool.label}
                        </h3>
                        <p className="text-sm text-slate-500">
                          {tool.description}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                {/* Pass props to ActiveComponent if it's TendersTool */}
                {activeToolId === 'tenders' ? (
                   // @ts-ignore
                   <ActiveComponent domain={params.domain} searchParams={searchParams} />
                ) : (
                   <ActiveComponent />
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}