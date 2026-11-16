import localFont from "next/font/local";

/** Local copies of the exact Sora and IBM Plex Mono weights used by Assistant. */
export const assistantDisplay = localFont({
  src: [{ path: "./Sora[wght].ttf", weight: "400 700", style: "normal" }],
  display: "swap",
  variable: "--assistant-display",
});

export const assistantMono = localFont({
  src: [
    { path: "./IBMPlexMono-Regular.ttf", weight: "400", style: "normal" },
    { path: "./IBMPlexMono-Medium.ttf", weight: "500", style: "normal" },
  ],
  display: "swap",
  variable: "--assistant-mono",
});
