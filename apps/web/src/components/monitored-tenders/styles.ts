export const sourcePillClasses: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700",
  green: "bg-green-50 text-green-700",
  purple: "bg-purple-50 text-purple-700",
  amber: "bg-amber-50 text-amber-700",
  rose: "bg-rose-50 text-rose-700",
  cyan: "bg-cyan-50 text-cyan-700",
  indigo: "bg-indigo-50 text-indigo-700",
  fuchsia: "bg-fuchsia-50 text-fuchsia-700",
};

export const sourceHeaderClasses: Record<string, string> = {
  blue: "from-slate-50 via-white to-blue-50/60",
  green: "from-slate-50 via-white to-green-50/60",
  purple: "from-slate-50 via-white to-purple-50/60",
  amber: "from-slate-50 via-white to-amber-50/60",
  rose: "from-slate-50 via-white to-rose-50/60",
  cyan: "from-slate-50 via-white to-cyan-50/60",
  indigo: "from-slate-50 via-white to-indigo-50/60",
  fuchsia: "from-slate-50 via-white to-fuchsia-50/60",
};

export const groupPillClasses: Record<string, string> = {
  esg: "bg-emerald-100 text-emerald-800",
  credit_rating: "bg-blue-100 text-blue-800",
};

export const deadlineClasses: Record<string, string> = {
  past: "bg-slate-100 text-slate-500",
  gray: "bg-gray-100 text-gray-800",
  yellow: "bg-yellow-100 text-yellow-800",
  orange: "bg-orange-100 text-orange-800",
  red: "bg-red-100 text-red-800",
};

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
