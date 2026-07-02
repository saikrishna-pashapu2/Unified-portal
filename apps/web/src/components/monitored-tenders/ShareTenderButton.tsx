"use client";

import { Share2 } from "lucide-react";
import { useState, useTransition } from "react";

export default function ShareTenderButton({ title }: { title: string }) {
  const [message, setMessage] = useState("Share");
  const [isPending, startTransition] = useTransition();

  function share() {
    startTransition(async () => {
      const url = window.location.href;
      try {
        if (navigator.share) {
          await navigator.share({ title, url });
          setMessage("Shared");
        } else {
          await navigator.clipboard.writeText(url);
          setMessage("Copied");
        }
      } catch {
        setMessage("Share");
      }
      window.setTimeout(() => setMessage("Share"), 1800);
    });
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={isPending}
      className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-70"
    >
      <Share2 className="h-4 w-4" />
      {message}
    </button>
  );
}
