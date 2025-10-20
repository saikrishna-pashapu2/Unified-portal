"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Power, Save, X } from "lucide-react";

interface AlertConfig {
  id?: number;
  alert_name: string;
  alert_type: "weekly_digest" | "daily_digest" | "immediate_alerts";
  is_active: boolean;
  domains: string[]; // Can be ['esg'], ['credit'], or ['esg', 'credit'] for both
  
  // Schedule (for weekly/daily digests)
  digest_day?: string;
  digest_hour?: number;
  
  // Immediate Alerts filters (only for immediate alerts)
  immediate_sources: string[];
  immediate_keywords: string[];
  immediate_content_types: string[];
  
  email_enabled: boolean;
  email_address?: string;
  timezone: string;
}

const ALERT_TYPES = [
  { value: "weekly_digest", label: "Weekly Digest", icon: "📅" },
  { value: "daily_digest", label: "Daily Digest", icon: "📆" },
  { value: "immediate_alerts", label: "Immediate Alerts", icon: "⚡" },
];

const CONTENT_TYPES = ["articles", "events", "publications"];

const DAYS_OF_WEEK = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
];

export default function AlertSettingsNew({ domain }: { domain: "esg" | "credit" }) {
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [editingAlert, setEditingAlert] = useState<AlertConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  // TODO: Enable when source filtering is needed
  // Available sources (will be fetched from API)
  // const [availableSources, setAvailableSources] = useState<{
  //   articles: string[];
  //   events: string[];
  //   publications: string[];
  // }>({
  //   articles: [],
  //   events: [],
  //   publications: [],
  // });

  useEffect(() => {
    loadAlerts();
    // TODO: Enable when source filtering is needed
    // loadAvailableSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  const loadAlerts = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/alerts/preferences?domain=${domain}`);
      const data = await res.json();
      if (data.ok) {
        setAlerts(data.alerts || []);
      }
    } catch (error) {
      console.error("Failed to load alerts:", error);
    } finally {
      setLoading(false);
    }
  };

  // TODO: Enable when source filtering is needed
  // const loadAvailableSources = async () => {
  //   try {
  //     const res = await fetch(`/api/alerts/sources?domain=${domain}`);
  //     const data = await res.json();
  //     if (data.ok) {
  //       setAvailableSources(data.sources);
  //     }
  //   } catch (error) {
  //     console.error("Failed to load sources:", error);
  //   }
  // };

  const createNewAlert = () => {
    const newAlert: AlertConfig = {
      alert_name: "New Alert",
      alert_type: "weekly_digest",
      is_active: true,
      domains: [domain], // Default to user's current domain
      immediate_sources: [],
      immediate_keywords: [],
      immediate_content_types: ["articles"],
      digest_day: "monday",
      digest_hour: 9,
      email_enabled: true,
      timezone: "Asia/Dubai",
    };
    setEditingAlert(newAlert);
    setIsCreating(true);
  };

  const saveAlert = async () => {
    if (!editingAlert) return;
    
    setSaving(true);
    setMessage(null);
    
    try {
      const url = editingAlert.id 
        ? `/api/alerts/preferences/${editingAlert.id}` 
        : `/api/alerts/preferences`;
      
      const res = await fetch(url, {
        method: editingAlert.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingAlert),
      });
      
      const data = await res.json();
      
      if (data.ok) {
        setMessage({ type: "success", text: "Alert saved successfully!" });
        setEditingAlert(null);
        setIsCreating(false);
        loadAlerts();
      } else {
        setMessage({ type: "error", text: data.reason || "Failed to save alert" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "An error occurred while saving" });
    } finally {
      setSaving(false);
    }
  };

  const deleteAlert = async (id: number) => {
    if (!confirm("Are you sure you want to delete this alert?")) return;
    
    try {
      const res = await fetch(`/api/alerts/preferences/${id}`, {
        method: "DELETE",
      });
      
      const data = await res.json();
      
      if (data.ok) {
        setMessage({ type: "success", text: "Alert deleted successfully!" });
        loadAlerts();
      } else {
        setMessage({ type: "error", text: "Failed to delete alert" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "An error occurred while deleting" });
    }
  };

  const toggleAlert = async (id: number, currentState: boolean) => {
    try {
      const res = await fetch(`/api/alerts/preferences/${id}/toggle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !currentState }),
      });
      
      const data = await res.json();
      
      if (data.ok) {
        loadAlerts();
      }
    } catch (error) {
      console.error("Failed to toggle alert:", error);
    }
  };

  const renderFilterSection = () => {
    if (!editingAlert) return null;
    
    const type = editingAlert.alert_type;
    
    // Weekly and Daily digests don't have filters - they send all team-liked content
    if (type === "weekly_digest" || type === "daily_digest") {
      const digestHour = editingAlert.digest_hour || 9;
      const formatHour = (hour: number) => {
        const period = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${displayHour}:00 ${period}`;
      };

      return (
        <div className="space-y-4">
          <div className="p-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="text-2xl">ℹ️</div>
              <div>
                <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                  {type === "weekly_digest" ? "Weekly" : "Daily"} Digest
                </h4>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {type === "weekly_digest" 
                    ? "Sends all articles, events, and publications liked by your team members every Monday. No filtering needed - you'll get everything your team found interesting!"
                    : "Sends all articles, events, and publications liked by your team members daily (last 24 hours). No filtering needed - you'll get everything your team found interesting!"
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Time Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              ⏰ Delivery Time
            </label>
            <select
              value={digestHour}
              onChange={(e) => {
                setEditingAlert({
                  ...editingAlert,
                  digest_hour: parseInt(e.target.value),
                });
              }}
              className="w-full md:w-64 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {Array.from({ length: 24 }, (_, i) => i).map(hour => (
                <option key={hour} value={hour}>
                  {formatHour(hour)}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Choose what time you want to receive your digest email (timezone: {editingAlert.timezone || 'Asia/Dubai'})
            </p>
          </div>
        </div>
      );
    }
    
    // Only immediate alerts have filters
    const selectedSources = editingAlert.immediate_sources || [];
    const selectedKeywords = editingAlert.immediate_keywords || [];
    const selectedContentTypes = editingAlert.immediate_content_types || [];

    // Immediate alerts filters
    return (
      <div className="space-y-6">
        {/* Content Types Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Content Types
          </label>
          <div className="flex flex-wrap gap-2">
            {CONTENT_TYPES.map((contentType) => (
              <button
                key={contentType}
                type="button"
                onClick={() => {
                  const newTypes = selectedContentTypes.includes(contentType)
                    ? selectedContentTypes.filter(t => t !== contentType)
                    : [...selectedContentTypes, contentType];
                  setEditingAlert({
                    ...editingAlert,
                    immediate_content_types: newTypes,
                  });
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedContentTypes.includes(contentType)
                    ? "bg-emerald-100 text-emerald-700 border-2 border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "bg-gray-100 text-gray-600 border-2 border-transparent dark:bg-gray-700 dark:text-gray-300"
                }`}
              >
                {contentType.charAt(0).toUpperCase() + contentType.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Sources Selection - TODO: Enable when needed */}
        {/* <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Sources (Select multiple)
          </label>
          <div className="space-y-4">
            {selectedContentTypes.map((contentType) => {
              const sources = availableSources[contentType as keyof typeof availableSources] || [];
              
              return (
                <div key={contentType} className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                    {contentType}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {sources.length > 0 ? sources.map((source: string) => (
                      <button
                        key={source}
                        type="button"
                        onClick={() => {
                          const newSources = selectedSources.includes(source)
                            ? selectedSources.filter(s => s !== source)
                            : [...selectedSources, source];
                          setEditingAlert({
                            ...editingAlert,
                            immediate_sources: newSources,
                          });
                        }}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          selectedSources.includes(source)
                            ? "bg-blue-100 text-blue-700 border border-blue-500 dark:bg-blue-900/30 dark:text-blue-300"
                            : "bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {source}
                      </button>
                    )) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">No sources available</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div> */}

        {/* Keywords */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Keywords (comma-separated)
          </label>
          <input
            type="text"
            value={selectedKeywords.join(", ")}
            onChange={(e) => {
              const keywords = e.target.value.split(",").map(k => k.trim()).filter(k => k);
              setEditingAlert({
                ...editingAlert,
                immediate_keywords: keywords,
              });
            }}
            placeholder="e.g., climate change, sustainability, carbon"
            className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="text-center py-8">Loading alerts...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Message */}
      {message && (
        <div className={`p-4 rounded-lg ${message.type === "success" ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200" : "bg-red-50 dark:bg-red-900/20 border border-red-200"}`}>
          <p className={`text-sm ${message.type === "success" ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200"}`}>
            {message.text}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Your Alerts</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Manage your email alerts and notifications
          </p>
        </div>
        <button
          onClick={createNewAlert}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Alert
        </button>
      </div>

      {/* Alert List */}
      {!editingAlert && alerts.length === 0 && (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <p className="text-gray-600 dark:text-gray-400">No alerts configured yet</p>
          <button
            onClick={createNewAlert}
            className="mt-4 text-emerald-600 hover:text-emerald-700 font-medium"
          >
            Create your first alert
          </button>
        </div>
      )}

      {!editingAlert && alerts.map((alert) => (
        <div
          key={alert.id}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-4"
        >
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {alert.alert_name}
                </h4>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  alert.is_active 
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                }`}>
                  {alert.is_active ? "Active" : "Inactive"}
                </span>
                {/* Domain badges */}
                {(alert.domains || []).map((d) => (
                  <span 
                    key={d}
                    className="px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 uppercase"
                  >
                    {d}
                  </span>
                ))}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {ALERT_TYPES.find(t => t.value === alert.alert_type)?.label}
                {(alert.domains || []).length === 2 && " • Both Domains"}
                {(alert.alert_type === 'daily_digest' || alert.alert_type === 'weekly_digest') && alert.digest_hour !== undefined && (
                  <>
                    {" • "}
                    <span className="text-gray-700 dark:text-gray-300">
                      ⏰ {(() => {
                        const hour = alert.digest_hour;
                        const period = hour >= 12 ? 'PM' : 'AM';
                        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                        return `${displayHour}:00 ${period}`;
                      })()}
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleAlert(alert.id!, alert.is_active)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title={alert.is_active ? "Disable" : "Enable"}
              >
                <Power className={`w-4 h-4 ${alert.is_active ? "text-emerald-600" : "text-gray-400"}`} />
              </button>
              <button
                onClick={() => setEditingAlert(alert)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Edit"
              >
                <Edit2 className="w-4 h-4 text-blue-600" />
              </button>
              <button
                onClick={() => deleteAlert(alert.id!)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Delete"
              >
                <Trash2 className="w-4 h-4 text-red-600" />
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Edit/Create Form */}
      {editingAlert && (
        <div className="bg-white dark:bg-gray-800 border-2 border-emerald-500 rounded-lg p-6 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isCreating ? "Create New Alert" : "Edit Alert"}
            </h3>
            <button
              onClick={() => {
                setEditingAlert(null);
                setIsCreating(false);
              }}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Alert Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Alert Name
            </label>
            <input
              type="text"
              value={editingAlert.alert_name}
              onChange={(e) => setEditingAlert({ ...editingAlert, alert_name: e.target.value })}
              placeholder="e.g., Weekly ESG Updates"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Domain Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Domains (Select one or both)
            </label>
            <div className="flex flex-wrap gap-3">
              {["esg", "credit"].map((domainOption) => (
                <button
                  key={domainOption}
                  type="button"
                  onClick={() => {
                    const currentDomains = editingAlert.domains || [];
                    const newDomains = currentDomains.includes(domainOption)
                      ? currentDomains.filter(d => d !== domainOption)
                      : [...currentDomains, domainOption];
                    
                    // Ensure at least one domain is selected
                    if (newDomains.length > 0) {
                      setEditingAlert({ ...editingAlert, domains: newDomains });
                    }
                  }}
                  className={`px-6 py-3 rounded-lg text-sm font-medium transition-all ${
                    (editingAlert.domains || []).includes(domainOption)
                      ? "bg-blue-100 text-blue-700 border-2 border-blue-500 dark:bg-blue-900/30 dark:text-blue-300"
                      : "bg-gray-100 text-gray-600 border-2 border-gray-300 dark:bg-gray-700 dark:text-gray-300"
                  }`}
                >
                  <span className="uppercase font-bold">{domainOption}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {(editingAlert.domains || []).length === 2 
                ? "Receiving alerts from both ESG and Credit" 
                : `Receiving alerts from ${(editingAlert.domains || [domain])[0].toUpperCase()} only`}
            </p>
          </div>

          {/* Alert Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Alert Type
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              {ALERT_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setEditingAlert({ ...editingAlert, alert_type: type.value as any })}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    editingAlert.alert_type === type.value
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                  }`}
                >
                  <div className="text-2xl mb-2">{type.icon}</div>
                  <div className="font-medium text-gray-900 dark:text-white">{type.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Type-Specific Filters */}
          {renderFilterSection()}

          {/* Email Settings */}
          <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="email_enabled"
                checked={editingAlert.email_enabled}
                onChange={(e) => setEditingAlert({ ...editingAlert, email_enabled: e.target.checked })}
                className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
              />
              <label htmlFor="email_enabled" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Send email notifications
              </label>
            </div>

            {editingAlert.email_enabled && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email Address (optional - uses account email if empty)
                </label>
                <input
                  type="email"
                  value={editingAlert.email_address || ""}
                  onChange={(e) => setEditingAlert({ ...editingAlert, email_address: e.target.value })}
                  placeholder="custom@email.com"
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={() => {
                setEditingAlert(null);
                setIsCreating(false);
              }}
              className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveAlert}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save Alert"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
