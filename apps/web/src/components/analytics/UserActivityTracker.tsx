
"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

type TrackActivityProps = {
    action: string;
    resourceType?: string;
    resourceId?: number | string | null;
    details?: string | null;
    delayMs?: number;
};

async function postActivity(body: {
    action: string;
    resource_type?: string;
    resource_id?: number | string | null;
    details?: string | null;
    path?: string;
}) {
    try {
        await fetch("/api/tracking/log", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
    } catch (error) {
        console.error("Failed to track activity", error);
    }
}

export function TrackActivity({
    action,
    resourceType,
    resourceId,
    details,
    delayMs = 700,
}: TrackActivityProps) {
    const hasTrackedRef = useRef(false);

    useEffect(() => {
        if (hasTrackedRef.current) {
            return;
        }

        hasTrackedRef.current = true;

        const timeoutId = window.setTimeout(() => {
            void postActivity({
                action,
                resource_type: resourceType,
                resource_id: resourceId,
                details,
            });
        }, delayMs);

        return () => window.clearTimeout(timeoutId);
    }, [action, delayMs, details, resourceId, resourceType]);

    return null;
}

export function UserActivityTracker() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const lastPathRef = useRef<string | null>(null);

    useEffect(() => {
        // Construct full URL including search params for better context
        const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");

        // Avoid duplicate logs for the same path if react strict mode double renders
        // simple check, but effective enough
        if (lastPathRef.current === url) return;
        lastPathRef.current = url;

        const timeoutId = window.setTimeout(() => {
            void postActivity({
                action: "view_page",
                path: url,
                resource_type: "page",
                details: url,
            });
        }, 500);

        return () => clearTimeout(timeoutId);
    }, [pathname, searchParams]);

    return null;
}
