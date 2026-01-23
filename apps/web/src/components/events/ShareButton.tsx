"use client";

import { Share2 } from "lucide-react";

interface ShareButtonProps {
  title: string;
  text: string;
  className?: string;
}

export default function ShareButton({ title, text, className }: ShareButtonProps) {
  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text,
          url: window.location.href
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        // Could add a toast notification here in the future
      }
    } catch (error) {
      // Handle share errors silently
      console.log('Share failed:', error);
    }
  };

  return (
    <button
      onClick={handleShare}
      className={className || "btn btn-secondary w-full justify-center"}
    >
      <Share2 size={16} />
      Share Event
    </button>
  );
}