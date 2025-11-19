"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Domain } from "@/lib/db";
import { deleteDigest, triggerDigestGeneration, regenerateDigest } from "./actions";
import { format } from "date-fns";

interface Digest {
  id: number;
  week_start: Date;
  week_end: Date;
  created_at: Date;
  content: string;
}

interface DigestManagerProps {
  initialDigests: Digest[];
  domain: Domain;
  total: number;
  totalPages: number;
  currentPage: number;
}

export default function DigestManager({
  initialDigests,
  domain,
  total,
  totalPages,
  currentPage,
}: DigestManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [generating, setGenerating] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);

  const handleDomainChange = (newDomain: Domain) => {
    router.push(`/admin/weekly-digest?domain=${newDomain}`);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this digest?")) return;
    
    startTransition(async () => {
      await deleteDigest(domain, id);
    });
  };

  const handleRegenerate = async (id: number) => {
    if (!confirm("This will delete the current digest and generate a new one for the same week. Continue?")) return;
    
    setRegeneratingId(id);
    try {
      const result = await regenerateDigest(domain, id);
      if (!result.success) {
        alert("Failed to regenerate digest");
      }
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await triggerDigestGeneration(domain);
      if (!result.success) {
        alert("Failed to generate digest");
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Weekly Digest Management</h1>
        <div className="flex gap-4">
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => handleDomainChange("esg")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                domain === "esg"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              ESG
            </button>
            <button
              onClick={() => handleDomainChange("credit")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                domain === "credit"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Credit
            </button>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {generating ? (
              <>
                <span className="animate-spin">↻</span> Generating...
              </>
            ) : (
              <>
                <span>⚡</span> Generate Now
              </>
            )}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Week Range
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created At
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Content Size
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {initialDigests.map((digest) => (
              <tr key={digest.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  #{digest.id}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {format(new Date(digest.week_start), "MMM d")} -{" "}
                  {format(new Date(digest.week_end), "MMM d, yyyy")}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {format(new Date(digest.created_at), "MMM d, HH:mm")}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {digest.content.length} chars
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => handleRegenerate(digest.id)}
                    disabled={regeneratingId === digest.id}
                    className="text-indigo-600 hover:text-indigo-900 mr-4"
                  >
                    {regeneratingId === digest.id ? "Regenerating..." : "Regenerate"}
                  </button>
                  <button
                    onClick={() => handleDelete(digest.id)}
                    disabled={isPending}
                    className="text-red-600 hover:text-red-900"
                  >
                    {isPending ? "..." : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
            {initialDigests.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  No digests found for this domain.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
