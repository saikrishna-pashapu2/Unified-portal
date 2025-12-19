"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
    TrendingUp,
    Sparkles,
    BarChart3,
    ArrowRight,
    Calendar,
    BookOpen,
    Search,
    Activity,
    Zap
} from "lucide-react";
import CreditHero from "@/components/heroes/CreditHero";
import SnowfallEffect from "@/components/home/SnowfallEffect";

interface CreditHomeProps {
    articles: any[];
    freshCount: number;
    activeSources: number;
    session: any;
}

export default function CreditHome({
    articles,
    freshCount,
    activeSources,
    session
}: CreditHomeProps) {

    const container = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1
            }
        }
    };

    const item = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <div className="min-h-screen bg-background">
            <SnowfallEffect />
            <CreditHero />

            <main className="mx-auto max-w-[1200px] px-6 py-12 -mt-20 relative z-20">

                {/* Stats Dashboard */}
                <motion.div
                    variants={container}
                    initial="hidden"
                    animate="show"
                    className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-16"
                >
                    {/* Fresh Articles Card */}
                    <motion.div variants={item} className="group relative overflow-hidden rounded-3xl bg-card p-6 shadow-lg border border-border/50 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Sparkles className="w-24 h-24 text-primary" />
                        </div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                                    <Zap className="w-6 h-6" />
                                </div>
                                <span className="text-xs font-semibold bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                                    Live Updates
                                </span>
                            </div>
                            <h3 className="text-sm font-medium text-muted-foreground">Fresh Articles</h3>
                            <div className="flex items-baseline gap-2 mt-1">
                                <span className="text-4xl font-bold text-foreground">{freshCount}</span>
                                <span className="text-sm text-muted-foreground">today</span>
                            </div>
                            <Link href="/credit/articles" className="mt-6 inline-flex items-center text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                                View latest <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>
                    </motion.div>

                    {/* Active Sources Card */}
                    <motion.div variants={item} className="group relative overflow-hidden rounded-3xl bg-card p-6 shadow-lg border border-border/50 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Activity className="w-24 h-24 text-blue-500" />
                        </div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
                                    <Activity className="w-6 h-6" />
                                </div>
                                <span className="text-xs font-semibold bg-blue-500/10 text-blue-500 px-2.5 py-1 rounded-full">
                                    Monitoring
                                </span>
                            </div>
                            <h3 className="text-sm font-medium text-muted-foreground">Active Sources</h3>
                            <div className="flex items-baseline gap-2 mt-1">
                                <span className="text-4xl font-bold text-foreground">{activeSources}</span>
                                <span className="text-sm text-muted-foreground">sources</span>
                            </div>
                            <Link href="/credit/articles?source=" className="mt-6 inline-flex items-center text-sm font-medium text-blue-500 hover:text-blue-600 transition-colors">
                                Filter sources <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>
                    </motion.div>

                    {/* Quick Tools Card */}
                    <motion.div variants={item} className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500/5 to-purple-500/5 bg-card p-6 shadow-lg border border-border/50 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 lg:col-span-2">
                        <div className="flex flex-col h-full justify-between relative z-10">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-500">
                                            <BarChart3 className="w-6 h-6" />
                                        </div>
                                        <span className="text-xs font-semibold bg-indigo-500/10 text-indigo-500 px-2.5 py-1 rounded-full">
                                            Pro Tools
                                        </span>
                                    </div>
                                    <h3 className="text-xl font-bold text-foreground">Credit Analytics</h3>
                                    <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                                        Access professional grade tools for deep credit analysis and market monitoring.
                                    </p>
                                </div>
                                <div className="hidden sm:block">
                                    {/* Decorative mini chart or icon could go here */}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mt-6">
                                <Link href="/credit/fitch" className="flex items-center gap-2 p-2 rounded-lg hover:bg-background/50 transition-colors group/link">
                                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                                        <Search className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm font-medium text-foreground group-hover/link:text-indigo-600 transition-colors">Fitch Search</span>
                                </Link>
                                <Link href="/credit/methodologies" className="flex items-center gap-2 p-2 rounded-lg hover:bg-background/50 transition-colors group/link">
                                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
                                        <BookOpen className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm font-medium text-foreground group-hover/link:text-purple-600 transition-colors">Methodologies</span>
                                </Link>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                    {/* Latest Articles Column */}
                    <div className="lg:col-span-2 space-y-8">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
                                <TrendingUp className="w-6 h-6 text-primary" />
                                Latest Intelligence
                            </h2>
                            <Link href="/credit/articles" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                View all articles
                            </Link>
                        </div>

                        <div className="space-y-4">
                            {articles.slice(0, 6).map((article, i) => (
                                <motion.div
                                    key={article.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="group flex gap-4 p-4 rounded-2xl bg-card border border-border/50 hover:border-primary/20 hover:shadow-md transition-all"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-xs font-medium text-primary bg-primary/5 px-2 py-0.5 rounded-full">
                                                {article.source}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {article.date ? new Date(article.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                                            </span>
                                        </div>
                                        <Link href={`/credit/articles/${article.id}`}>
                                            <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 mb-1">
                                                {article.title || "Untitled Article"}
                                            </h3>
                                        </Link>
                                        <p className="text-sm text-muted-foreground line-clamp-2">
                                            {article.summary || "No summary available for this article..."}
                                        </p>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    {/* Sidebar / Tools */}
                    <div className="space-y-6">
                        <h2 className="text-xl font-bold text-foreground">Quick Access</h2>

                        <Link href="/credit/events" className="block group">
                            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 p-6 text-white shadow-lg transition-transform hover:scale-[1.02]">
                                <div className="relative z-10">
                                    <Calendar className="w-8 h-8 mb-4 opacity-90" />
                                    <h3 className="text-lg font-bold mb-1">Events Calendar</h3>
                                    <p className="text-blue-50 text-sm opacity-90">Track upcoming credit events and earnings calls.</p>
                                </div>
                                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-white/10 rounded-full blur-xl" />
                            </div>
                        </Link>

                        <Link href="/credit/publications" className="block group">
                            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-400 p-6 text-white shadow-lg transition-transform hover:scale-[1.02]">
                                <div className="relative z-10">
                                    <BookOpen className="w-8 h-8 mb-4 opacity-90" />
                                    <h3 className="text-lg font-bold mb-1">Publications</h3>
                                    <p className="text-emerald-50 text-sm opacity-90">Deep dive into credit research and reports.</p>
                                </div>
                                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-white/10 rounded-full blur-xl" />
                            </div>
                        </Link>

                        <div className="rounded-2xl bg-card border border-border/50 p-6">
                            <h3 className="font-semibold text-foreground mb-4">Market Summary</h3>
                            <div className="space-y-4">
                                {[
                                    { label: "High Yield", value: "+0.4%", trend: "up" },
                                    { label: "Inv. Grade", value: "-0.1%", trend: "down" },
                                    { label: "Emerging Mkts", value: "+0.2%", trend: "up" }
                                ].map((item) => (
                                    <div key={item.label} className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">{item.label}</span>
                                        <span className={item.trend === "up" ? "text-green-500 font-medium" : "text-red-500 font-medium"}>
                                            {item.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                </div>
            </main>
        </div>
    );
}
