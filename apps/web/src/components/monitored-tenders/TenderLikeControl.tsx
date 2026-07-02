"use client";

import { Heart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

type TenderLikeViewer = {
  memberKey: string;
  displayName: string;
};

type TenderLike = {
  team_member?: {
    display_name?: string | null;
    member_key?: string | null;
  } | null;
};

type Liker = {
  displayName: string;
  memberKey: string | null;
};

function normalizeLikes(likes: TenderLike[]): Liker[] {
  const seen = new Set<string>();
  const normalized: Liker[] = [];

  for (const like of likes) {
    const displayName = like.team_member?.display_name?.trim();
    if (!displayName) continue;

    const memberKey = like.team_member?.member_key?.trim() || null;
    const uniqueKey = memberKey ?? displayName.toLowerCase();
    if (seen.has(uniqueKey)) continue;

    seen.add(uniqueKey);
    normalized.push({ displayName, memberKey });
  }

  return normalized;
}

function likerSummary(names: string[], limit: number): string | null {
  if (!names.length) return null;

  const visible = names.slice(0, limit).join(", ");
  const remaining = names.length - limit;
  return remaining > 0 ? `Liked by ${visible} and ${remaining} others` : `Liked by ${visible}`;
}

export default function TenderLikeControl({
  tenderId,
  likes,
  viewer,
  variant = "compact",
}: {
  tenderId: string;
  likes: TenderLike[];
  viewer: TenderLikeViewer | null;
  variant?: "compact" | "detail";
}) {
  const router = useRouter();
  const [likers, setLikers] = useState(() => normalizeLikes(likes));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const likedByViewer = useMemo(
    () => Boolean(viewer?.memberKey && likers.some((liker) => liker.memberKey === viewer.memberKey)),
    [likers, viewer?.memberKey],
  );
  const names = likers.map((liker) => liker.displayName);
  const summary = likerSummary(names, variant === "detail" ? 3 : 2);

  function submit() {
    if (!viewer) return;

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/monitored-tenders/${tenderId}/likes`, {
        method: likedByViewer ? "DELETE" : "POST",
      });

      if (response.status === 401) {
        setError("Sign in to like tenders.");
        return;
      }

      if (!response.ok) {
        setError("Could not update like.");
        return;
      }

      const state = await response.json();
      const nextLikes = Array.isArray(state.likes) ? state.likes : [];
      setLikers(normalizeLikes(nextLikes));
      router.refresh();
    });
  }

  return (
    <div className={variant === "detail" ? "flex w-full flex-col gap-2 sm:items-end" : "flex flex-col items-end gap-1.5"}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !viewer}
          title={!viewer ? "Sign in to like" : likedByViewer ? "Unlike" : "Like"}
          className={`inline-flex h-9 items-center gap-1.5 rounded-2xl border px-3 text-xs font-medium shadow-sm shadow-slate-100 transition disabled:cursor-not-allowed disabled:opacity-50 ${
            likedByViewer
              ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Heart className={`h-3.5 w-3.5 ${likedByViewer ? "fill-rose-500 text-rose-500" : "text-slate-500"}`} />
          <span>{likers.length}</span>
          {likedByViewer ? "Unlike" : "Like"}
        </button>
      </div>

      {variant === "detail" ? (
        <div className="flex max-w-[28rem] flex-wrap items-center gap-1.5 text-xs text-slate-500 sm:justify-end">
          {names.length ? <span className="mr-1">Liked by</span> : <span>No likes yet</span>}
          {likers.map((liker, index) => (
            <span key={liker.memberKey ?? `${liker.displayName}-${index}`} className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 font-medium text-slate-700">
              {liker.displayName}
            </span>
          ))}
        </div>
      ) : summary ? (
        <p className="max-w-[14rem] truncate text-right text-[11px] text-slate-500" title={summary}>
          {summary}
        </p>
      ) : null}

      {error ? <p className="max-w-[14rem] text-right text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}
