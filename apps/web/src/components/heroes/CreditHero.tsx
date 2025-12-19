"use client";
import { motion } from "framer-motion";
import { TrendingUp, BarChart3, PieChart, LineChart, DollarSign, Building2 } from "lucide-react";

export default function CreditHero() {
  return (
    <div className="relative h-[70vh] w-full overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-zinc-900">
      
      {/* Animated gradient orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-40 -right-40 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute top-1/2 -left-20 w-80 h-80 bg-indigo-500/15 rounded-full blur-3xl"
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.3, 0.15, 0.3],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-20 right-1/3 w-72 h-72 bg-violet-500/15 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.3, 1],
            x: [0, -30, 0],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Floating chart icons */}
      <div className="absolute inset-0 overflow-hidden">
        {[
          { Icon: BarChart3, left: "8%", top: "25%", delay: 0 },
          { Icon: PieChart, left: "88%", top: "20%", delay: 1 },
          { Icon: LineChart, left: "80%", top: "65%", delay: 2 },
          { Icon: DollarSign, left: "12%", top: "70%", delay: 1.5 },
          { Icon: TrendingUp, left: "92%", top: "45%", delay: 0.5 },
          { Icon: Building2, left: "5%", top: "45%", delay: 2.5 },
        ].map(({ Icon, left, top, delay }, i) => (
          <motion.div
            key={i}
            className="absolute text-white/[0.07]"
            style={{ left, top }}
            animate={{
              y: [0, -12, 0],
              rotate: [0, 3, -3, 0],
              opacity: [0.07, 0.12, 0.07],
            }}
            transition={{
              duration: 5 + i,
              repeat: Infinity,
              ease: "easeInOut",
              delay,
            }}
          >
            <Icon size={35 + i * 5} />
          </motion.div>
        ))}
      </div>

      {/* Animated grid pattern */}
      <div className="absolute inset-0 opacity-[0.04]">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.15) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.15) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }} />
      </div>

      {/* Animated stock chart line */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.08]" preserveAspectRatio="none">
        <motion.path
          d="M0,300 Q150,250 300,280 T600,220 T900,260 T1200,200 T1500,240 T1800,180 T2100,220"
          fill="none"
          stroke="url(#chartGradient)"
          strokeWidth="2"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 3, ease: "easeOut" }}
        />
        <defs>
          <linearGradient id="chartGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="50%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#06B6D4" />
          </linearGradient>
        </defs>
      </svg>

      {/* Glowing ring decorations */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] rounded-full border border-blue-400/10"
        animate={{ rotate: 360 }}
        transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
      />
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] rounded-full border border-indigo-400/5"
        animate={{ rotate: -360 }}
        transition={{ duration: 70, repeat: Infinity, ease: "linear" }}
      />

      {/* Main content */}
      <div className="relative z-10 flex h-full items-center justify-center px-6">
        <div className="text-center max-w-4xl mx-auto">
          
          {/* Glowing icon */}
          <motion.div 
            className="mb-8 inline-flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-2xl shadow-blue-500/25"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
          >
            <TrendingUp className="h-12 w-12 text-white" />
          </motion.div>
          
          {/* Title */}
          <motion.h1 
            className="mb-6 text-5xl font-bold leading-tight text-white md:text-6xl lg:text-7xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <span className="bg-gradient-to-r from-blue-200 via-slate-100 to-indigo-200 bg-clip-text text-transparent">
              Credit Rating
            </span>
          </motion.h1>
          
          {/* Subtitle */}
          <motion.p 
            className="mx-auto max-w-2xl text-xl leading-relaxed text-slate-300/80"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            Professional credit analysis, market insights & methodologies for informed decision-making
          </motion.p>
          
          {/* Feature tags */}
          <motion.div 
            className="mt-10 flex flex-wrap justify-center gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
          >
            {[
              { icon: BarChart3, label: "Analytics" },
              { icon: TrendingUp, label: "Reports" },
              { icon: LineChart, label: "Live Data" }
            ].map((item) => (
              <div
                key={item.label}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm px-5 py-2.5 text-sm font-medium text-white/90 border border-white/15 hover:bg-white/15 transition-colors"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}