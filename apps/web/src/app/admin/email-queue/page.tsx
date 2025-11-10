"use client";

import { useEffect, useState } from "react";

interface EmailQueueItem {
  id: number;
  user_id: number | null;
  email_to: string;
  email_subject: string;
  email_body: string;
  status: string;
  alert_type: string | null;
  domain: string | null;
  created_at: string;
  sent_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  attempts: number;
  scheduled_for: string | null;
  user?: {
    name: string | null;
    email: string;
  } | null;
}

interface Stats {
  overview: {
    total: number;
    queued: number;
    sent: number;
    failed: number;
    processing: number;
  };
  recentFailures: Array<{
    id: number;
    email_to: string;
    email_subject: string;
    last_error: string | null;
    attempts: number;
    last_attempt_at: string | null;
  }>;
}

export default function EmailQueueManagementPage() {
  const [emails, setEmails] = useState<EmailQueueItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Scheduler status
  const [schedulerStatus, setSchedulerStatus] = useState<{
    isRunning: boolean;
    tasks: {
      alertProcessing: boolean;
      emailQueue: boolean;
    };
  } | null>(null);
  const [schedulerLoading, setSchedulerLoading] = useState(false);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [alertTypeFilter, setAlertTypeFilter] = useState<string>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const pageSize = 50;
  
  // Manual send form
  const [showSendForm, setShowSendForm] = useState(false);
  const [sendForm, setSendForm] = useState({
    to: "",
    subject: "",
    htmlBody: "",
    userId: "",
  });
  
  // Clear old emails
  const [clearDays, setClearDays] = useState("30");
  const [clearStatus, setClearStatus] = useState("sent");
  
  // Selected emails for bulk actions
  const [selectedEmails, setSelectedEmails] = useState<number[]>([]);

  useEffect(() => {
    fetchEmails();
    fetchStats();
    fetchSchedulerStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, statusFilter, alertTypeFilter, domainFilter]);

  const fetchEmails = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        skip: ((currentPage - 1) * pageSize).toString(),
        take: pageSize.toString(),
      });
      
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (alertTypeFilter !== "all") params.append("alertType", alertTypeFilter);
      if (domainFilter !== "all") params.append("domain", domainFilter);

      const response = await fetch(`/api/admin/email-queue?${params}`);
      const data = await response.json();

      if (response.ok) {
        setEmails(data.emails || []);
        setHasMore(data.hasMore || false);
      } else {
        console.error("Failed to fetch emails:", data.error);
      }
    } catch (error) {
      console.error("Error fetching emails:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/admin/email-queue/stats");
      const data = await response.json();
      if (response.ok) {
        setStats(data);
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  };

  const fetchSchedulerStatus = async () => {
    try {
      const response = await fetch("/api/admin/scheduler/status");
      const data = await response.json();
      if (response.ok && data.success) {
        setSchedulerStatus(data.status);
      }
    } catch (error) {
      console.error("Error fetching scheduler status:", error);
    }
  };

  const handleStartScheduler = async () => {
    setSchedulerLoading(true);
    try {
      const response = await fetch("/api/admin/scheduler/start", {
        method: "POST",
      });
      const data = await response.json();
      
      if (data.success) {
        alert(`✅ ${data.message}`);
        // Refresh status after a short delay to show updated state
        setTimeout(() => {
          fetchSchedulerStatus();
        }, 500);
      } else {
        alert(`❌ ${data.message || data.error}`);
        // Still refresh to show accurate state
        fetchSchedulerStatus();
      }
    } catch (error) {
      console.error("Error starting scheduler:", error);
      alert("❌ Failed to start scheduler - check console for details");
    } finally {
      setSchedulerLoading(false);
    }
  };

  const handleStopScheduler = async () => {
    if (!confirm("⚠️ Are you sure you want to stop the email scheduler?\n\nEmails will not be processed automatically until you start it again.")) {
      return;
    }

    setSchedulerLoading(true);
    try {
      const response = await fetch("/api/admin/scheduler/stop", {
        method: "POST",
      });
      const data = await response.json();
      
      if (data.success) {
        alert(`✅ ${data.message}`);
        // Refresh status after a short delay to show updated state
        setTimeout(() => {
          fetchSchedulerStatus();
        }, 500);
      } else {
        alert(`❌ ${data.message || data.error}`);
        // Still refresh to show accurate state
        fetchSchedulerStatus();
      }
    } catch (error) {
      console.error("Error stopping scheduler:", error);
      alert("❌ Failed to stop scheduler - check console for details");
    } finally {
      setSchedulerLoading(false);
    }
  };

  const handleRetryFailed = async () => {
    if (selectedEmails.length === 0) {
      alert("Please select emails to retry");
      return;
    }

    setActionLoading(true);
    try {
      const response = await fetch("/api/admin/email-queue/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: selectedEmails }),
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Successfully retried ${data.count} emails`);
        setSelectedEmails([]);
        fetchEmails();
        fetchStats();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error("Error retrying emails:", error);
      alert("Failed to retry emails");
    } finally {
      setActionLoading(false);
    }
  };

  const handleClearOld = async () => {
    if (!confirm(`Delete all ${clearStatus} emails older than ${clearDays} days?`)) {
      return;
    }

    setActionLoading(true);
    try {
      const response = await fetch(
        `/api/admin/email-queue/clear?days=${clearDays}&status=${clearStatus}`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (response.ok) {
        alert(data.message);
        fetchEmails();
        fetchStats();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error("Error clearing emails:", error);
      alert("Failed to clear emails");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendManual = async () => {
    if (!sendForm.to || !sendForm.subject || !sendForm.htmlBody) {
      alert("Please fill in all required fields");
      return;
    }

    setActionLoading(true);
    try {
      const response = await fetch("/api/admin/email-queue/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendForm),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Email sent successfully!");
        setShowSendForm(false);
        setSendForm({ to: "", subject: "", htmlBody: "", userId: "" });
        fetchEmails();
        fetchStats();
      } else {
        alert(`Error: ${data.error}\n${data.details || ""}`);
      }
    } catch (error) {
      console.error("Error sending email:", error);
      alert("Failed to send email");
    } finally {
      setActionLoading(false);
    }
  };

  const toggleEmailSelection = (emailId: number) => {
    setSelectedEmails((prev) =>
      prev.includes(emailId) ? prev.filter((id) => id !== emailId) : [...prev, emailId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedEmails.length === emails.length) {
      setSelectedEmails([]);
    } else {
      setSelectedEmails(emails.map((e) => e.id));
    }
  };

  const getStatusBadgeClass = (status: string) => {
    const classes: Record<string, string> = {
      queued: "bg-blue-100 text-blue-800",
      sent: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
      processing: "bg-yellow-100 text-yellow-800",
    };
    return classes[status] || classes.queued;
  };

  const filteredEmails = emails.filter((email) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      email.email_to.toLowerCase().includes(query) ||
      email.email_subject.toLowerCase().includes(query) ||
      email.user?.name?.toLowerCase().includes(query) ||
      email.user?.email.toLowerCase().includes(query)
    );
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Email Queue Management</h1>
          <p className="text-gray-600 mt-1">Monitor and manage email delivery queue</p>
        </div>
        <button
          onClick={() => setShowSendForm(!showSendForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          📧 Send Manual Email
        </button>
      </div>

      {/* Scheduler Control Panel */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
              <span className="text-2xl">⚙️</span>
              Email Cron Scheduler
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Control the automated email processing jobs
            </p>
            {schedulerStatus && (
              <div className="mt-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    schedulerStatus.isRunning 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {schedulerStatus.isRunning ? '● Running' : '○ Stopped'}
                  </span>
                </div>
                <div className="text-xs text-gray-500 space-y-0.5">
                  <div>Alert Processing: {schedulerStatus.tasks.alertProcessing ? '✅ Active' : '❌ Inactive'}</div>
                  <div>Email Queue: {schedulerStatus.tasks.emailQueue ? '✅ Active' : '❌ Inactive'}</div>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleStartScheduler}
              disabled={schedulerLoading || schedulerStatus?.isRunning}
              className={`px-6 py-3 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                schedulerStatus?.isRunning
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {schedulerLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <span className="text-xl">▶️</span>
                  <span>Start Scheduler</span>
                </>
              )}
            </button>
            <button
              onClick={handleStopScheduler}
              disabled={schedulerLoading || !schedulerStatus?.isRunning}
              className={`px-6 py-3 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                !schedulerStatus?.isRunning
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-red-600 text-white hover:bg-red-700'
              }`}
            >
              {schedulerLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <span className="text-xl">⏹️</span>
                  <span>Stop Scheduler</span>
                </>
              )}
            </button>
            <button
              onClick={fetchSchedulerStatus}
              disabled={schedulerLoading}
              className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium transition-colors flex items-center gap-2"
              title="Refresh scheduler status"
            >
              <span className="text-xl">🔄</span>
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <div className="text-sm text-gray-600">Total Emails</div>
            <div className="text-2xl font-bold mt-1">{stats.overview.total.toLocaleString()}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <div className="text-sm text-gray-600">Queued</div>
            <div className="text-2xl font-bold mt-1 text-blue-600">{stats.overview.queued.toLocaleString()}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <div className="text-sm text-gray-600">Sent</div>
            <div className="text-2xl font-bold mt-1 text-green-600">{stats.overview.sent.toLocaleString()}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <div className="text-sm text-gray-600">Failed</div>
            <div className="text-2xl font-bold mt-1 text-red-600">{stats.overview.failed.toLocaleString()}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <div className="text-sm text-gray-600">Processing</div>
            <div className="text-2xl font-bold mt-1 text-yellow-600">{stats.overview.processing.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Manual Send Form */}
      {showSendForm && (
        <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
          <h2 className="text-xl font-bold">Send Manual Email</h2>
          <div className="grid gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">To (Email Address) *</label>
              <input
                type="email"
                placeholder="user@example.com"
                value={sendForm.to}
                onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Subject *</label>
              <input
                type="text"
                placeholder="Email subject"
                value={sendForm.subject}
                onChange={(e) => setSendForm({ ...sendForm, subject: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">HTML Body *</label>
              <textarea
                placeholder="<p>HTML email content...</p>"
                rows={8}
                value={sendForm.htmlBody}
                onChange={(e) => setSendForm({ ...sendForm, htmlBody: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">User ID (optional)</label>
              <input
                type="number"
                placeholder="123"
                value={sendForm.userId}
                onChange={(e) => setSendForm({ ...sendForm, userId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSendManual}
              disabled={actionLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {actionLoading ? "Sending..." : "Send Email"}
            </button>
            <button
              onClick={() => setShowSendForm(false)}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters and Actions */}
      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
        <h2 className="text-xl font-bold">Filters and Actions</h2>
        
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Search</label>
            <input
              type="text"
              placeholder="Search by email or subject..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="all">All Statuses</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="processing">Processing</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Alert Type</label>
            <select
              value={alertTypeFilter}
              onChange={(e) => setAlertTypeFilter(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="all">All Types</option>
              <option value="immediate">Immediate</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Domain</label>
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="all">All Domains</option>
              <option value="esg">ESG</option>
              <option value="credit">Credit</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleRetryFailed}
            disabled={selectedEmails.length === 0 || actionLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            🔄 Retry Selected ({selectedEmails.length})
          </button>
          
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Days"
              value={clearDays}
              onChange={(e) => setClearDays(e.target.value)}
              className="w-20 px-3 py-2 border rounded-lg"
            />
            <select
              value={clearStatus}
              onChange={(e) => setClearStatus(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
            <button
              onClick={handleClearOld}
              disabled={actionLoading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              🗑️ Clear Old
            </button>
          </div>
        </div>
      </div>

      {/* Email Queue Table */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="p-6">
          <h2 className="text-xl font-bold mb-4">Email Queue</h2>
          <p className="text-sm text-gray-600 mb-4">
            Showing {filteredEmails.length} of {emails.length} emails
          </p>

          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      <input
                        type="checkbox"
                        checked={selectedEmails.length === emails.length && emails.length > 0}
                        onChange={toggleSelectAll}
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Domain</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attempts</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sent At</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredEmails.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                        No emails found
                      </td>
                    </tr>
                  ) : (
                    filteredEmails.map((email) => (
                      <tr key={email.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedEmails.includes(email.id)}
                            onChange={() => toggleEmailSelection(email.id)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm font-medium">{email.email_to}</td>
                        <td className="px-4 py-3 text-sm max-w-xs truncate" title={email.email_subject}>
                          {email.email_subject}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {email.user ? (
                            <div>
                              <div className="font-medium">{email.user.name || "N/A"}</div>
                              <div className="text-xs text-gray-500">{email.user.email}</div>
                            </div>
                          ) : (
                            <span className="text-gray-400">N/A</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadgeClass(email.status)}`}>
                            {email.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="px-2 py-1 text-xs bg-gray-100 rounded">{email.alert_type || "N/A"}</span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="px-2 py-1 text-xs bg-gray-100 rounded">{email.domain || "none"}</span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {email.attempts > 0 ? (
                            <span className={email.status === "failed" ? "text-red-600 font-semibold" : ""}>
                              {email.attempts}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {new Date(email.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {email.sent_at ? new Date(email.sent_at).toLocaleString() : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="flex justify-between items-center mt-4 pt-4 border-t">
            <div className="text-sm text-gray-600">
              Page {currentPage}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage((p) => p + 1)}
                disabled={!hasMore}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Failures */}
      {stats && stats.recentFailures.length > 0 && (
        <div className="bg-white p-6 rounded-lg border shadow-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            ⚠️ Recent Failures
          </h2>
          <p className="text-sm text-gray-600 mb-4">Last 10 failed email attempts</p>
          <div className="space-y-3">
            {stats.recentFailures.map((failure) => (
              <div
                key={failure.id}
                className="border rounded-lg p-3 space-y-1 hover:bg-gray-50"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{failure.email_to}</div>
                    <div className="text-sm text-gray-600">{failure.email_subject}</div>
                  </div>
                  <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full font-semibold">
                    {failure.attempts} {failure.attempts === 1 ? "attempt" : "attempts"}
                  </span>
                </div>
                {failure.last_error && (
                  <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                    {failure.last_error}
                  </div>
                )}
                {failure.last_attempt_at && (
                  <div className="text-xs text-gray-500">
                    Last attempt: {new Date(failure.last_attempt_at).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
