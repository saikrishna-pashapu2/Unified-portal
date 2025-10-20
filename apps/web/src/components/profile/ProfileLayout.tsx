"use client";
import { useState } from "react";
import { Session } from "next-auth";
import AlertsTabComponent from "./AlertsTab";

type Tab = "profile" | "admin" | "alerts";

interface ProfileLayoutProps {
  session: Session;
}

export default function ProfileLayout({ session }: ProfileLayoutProps) {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const user = session?.user as any;
  const role = (session as any)?.role ?? "user";
  const isAdmin = role === "admin";

  const tabs = [
    { id: "profile" as Tab, label: "Profile", icon: "👤", show: true },
    { id: "admin" as Tab, label: "Admin", icon: "⚙️", show: isAdmin },
    { id: "alerts" as Tab, label: "Alerts", icon: "�", show: true },
  ].filter(tab => tab.show);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            My Profile
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage your account settings and preferences
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <aside className="lg:w-64 flex-shrink-0">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden sticky top-4">
              {/* User Card */}
              <div className="p-6 bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-2xl font-bold">
                    {user?.name?.charAt(0)?.toUpperCase() || "U"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg truncate">{user?.name}</h3>
                    <p className="text-sm text-white/80 truncate">{user?.email}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full">
                    {role === "admin" ? "👑 Admin" : "👤 User"}
                  </span>
                </div>
              </div>

              {/* Navigation Tabs */}
              <nav className="p-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-left transition-all ${
                      activeTab === tab.id
                        ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 font-semibold shadow-sm"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    }`}
                  >
                    <span className="text-xl">{tab.icon}</span>
                    <span>{tab.label}</span>
                    {activeTab === tab.id && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-emerald-500" />
                    )}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 lg:p-8">
              {activeTab === "profile" && <ProfileTab session={session} />}
              {activeTab === "admin" && isAdmin && <AdminTab />}
              {activeTab === "alerts" && <AlertsTabComponent domain={(session as any)?.team ?? "esg"} />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

// Profile Tab
function ProfileTab({ session }: { session: Session }) {
  const user = session?.user as any;
  const [role] = useState((session as any)?.role ?? "user");
  const [team, setTeam] = useState((session as any)?.team ?? "esg");
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, team }),
      });

      const data = await res.json();

      if (data.ok) {
        setMessage({ type: "success", text: "Profile updated successfully!" });
        // Refresh the page to update session data
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setMessage({ type: "error", text: data.reason || "Failed to update profile" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "An error occurred while saving" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Profile Information</h2>
      
      <div className="space-y-6">
        {/* Success/Error Message */}
        {message && (
          <div className={`p-4 rounded-lg ${message.type === "success" ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800" : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"}`}>
            <div className="flex items-center">
              <svg className={`w-5 h-5 mr-2 ${message.type === "success" ? "text-emerald-500" : "text-red-500"}`} fill="currentColor" viewBox="0 0 20 20">
                {message.type === "success" ? (
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                ) : (
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                )}
              </svg>
              <span className={`text-sm ${message.type === "success" ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200"}`}>
                {message.text}
              </span>
            </div>
          </div>
        )}

        {/* Profile Picture Section */}
        <div className="flex items-center space-x-6 pb-6 border-b border-gray-200 dark:border-gray-700">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-4xl font-bold text-white shadow-lg">
            {name?.charAt(0)?.toUpperCase() || user?.name?.charAt(0)?.toUpperCase() || "U"}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{name || user?.name}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">{email || user?.email}</p>
            <button className="mt-2 text-sm text-emerald-600 hover:text-emerald-700 font-medium">
              Change Avatar
            </button>
          </div>
        </div>

        {/* Information Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
            <div className="px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 capitalize">
              {role}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Team</label>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="esg">ESG</option>
              <option value="credit">Credit</option>
            </select>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-4">
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold rounded-lg hover:from-emerald-600 hover:to-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Admin Tab
function AdminTab() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Admin Panel</h2>
      
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
            <div className="text-3xl mb-2">👥</div>
            <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">1,234</div>
            <div className="text-sm text-blue-700 dark:text-blue-300">Total Users</div>
          </div>
          
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20 rounded-xl p-6 border border-emerald-200 dark:border-emerald-800">
            <div className="text-3xl mb-2">📄</div>
            <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">5,678</div>
            <div className="text-sm text-emerald-700 dark:text-emerald-300">Total Articles</div>
          </div>
          
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-xl p-6 border border-purple-200 dark:border-purple-800">
            <div className="text-3xl mb-2">⚡</div>
            <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">89%</div>
            <div className="text-sm text-purple-700 dark:text-purple-300">System Health</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="flex items-center space-x-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors text-left">
              <span className="text-2xl">➕</span>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">Add New User</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">Create a new user account</div>
              </div>
            </button>
            
            <button className="flex items-center space-x-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors text-left">
              <span className="text-2xl">📊</span>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">View Analytics</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">System usage statistics</div>
              </div>
            </button>
            
            <button className="flex items-center space-x-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors text-left">
              <span className="text-2xl">🗂️</span>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">Manage Content</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">Articles and publications</div>
              </div>
            </button>
            
            <button className="flex items-center space-x-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors text-left">
              <span className="text-2xl">⚙️</span>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">System Settings</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">Configure portal settings</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}