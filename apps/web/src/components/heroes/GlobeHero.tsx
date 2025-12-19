"use client";
import { motion } from "framer-motion";
import { Leaf, Globe, TreePine, Droplets, Wind, Sun } from "lucide-react";

export default function GlobeHero() {
  return (
    <div className="relative h-[70vh] w-full overflow-hidden bg-gradient-to-br from-emerald-900 via-green-800 to-teal-900">
      
      {/* Animated gradient orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-40 -left-40 w-96 h-96 bg-emerald-500/30 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute top-1/2 -right-20 w-80 h-80 bg-teal-400/25 rounded-full blur-3xl"
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.4, 0.2, 0.4],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-20 left-1/3 w-72 h-72 bg-green-400/20 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.3, 1],
            x: [0, 30, 0],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Floating nature icons */}
      <div className="absolute inset-0 overflow-hidden">
        {[
          { Icon: TreePine, left: "10%", top: "20%", delay: 0 },
          { Icon: Droplets, left: "85%", top: "30%", delay: 1 },
          { Icon: Wind, left: "75%", top: "70%", delay: 2 },
          { Icon: Sun, left: "15%", top: "75%", delay: 1.5 },
          { Icon: Leaf, left: "90%", top: "15%", delay: 0.5 },
          { Icon: Globe, left: "5%", top: "50%", delay: 2.5 },
        ].map(({ Icon, left, top, delay }, i) => (
          <motion.div
            key={i}
            className="absolute text-white/10"
            style={{ left, top }}
            animate={{
              y: [0, -15, 0],
              rotate: [0, 5, -5, 0],
              opacity: [0.1, 0.2, 0.1],
            }}
            transition={{
              duration: 6 + i,
              repeat: Infinity,
              ease: "easeInOut",
              delay,
            }}
          >
            <Icon size={40 + i * 5} />
          </motion.div>
        ))}
      </div>

      {/* Animated grid lines */}
      <div className="absolute inset-0 opacity-[0.07]">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }} />
      </div>

      {/* Glowing ring decoration */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full border border-emerald-400/20"
        animate={{ rotate: 360 }}
        transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
      />
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-teal-400/10"
        animate={{ rotate: -360 }}
        transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
      />

      {/* Main content */}
      <div className="relative z-10 flex h-full items-center justify-center px-6">
        <div className="text-center max-w-4xl mx-auto">
          
          {/* Glowing icon */}
          <motion.div 
            className="mb-8 inline-flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-2xl shadow-emerald-500/30"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
          >
            <Leaf className="h-12 w-12 text-white" />
          </motion.div>
          
          {/* Title */}
          <motion.h1 
            className="mb-6 text-5xl font-bold leading-tight text-white md:text-6xl lg:text-7xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <span className="bg-gradient-to-r from-emerald-200 via-green-100 to-teal-200 bg-clip-text text-transparent">
              ESG
            </span>
          </motion.h1>
          
          {/* Subtitle */}
          <motion.p 
            className="mx-auto max-w-2xl text-xl leading-relaxed text-emerald-100/80"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            Environmental, Social, and Governance insights for sustainable investing
          </motion.p>
          
          {/* Feature tags */}
          <motion.div 
            className="mt-10 flex flex-wrap justify-center gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
          >
            {[
              { icon: Globe, label: "Global Coverage" },
              { icon: TreePine, label: "Sustainability" },
              { icon: Droplets, label: "Clean Energy" }
            ].map((item) => (
              <div
                key={item.label}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm px-5 py-2.5 text-sm font-medium text-white/90 border border-white/20 hover:bg-white/20 transition-colors"
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