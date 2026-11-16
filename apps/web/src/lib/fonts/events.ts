import localFont from "next/font/local";

/** Local copies of the ESG event ledger's selected font weights. */
export const eventSans = localFont({
  src: [{ path: "./IBMPlexSans[wdth,wght].ttf", weight: "400 600", style: "normal" }],
  display: "swap",
  variable: "--font-event-sans",
});

export const eventEditorial = localFont({
  src: [{ path: "./Newsreader[opsz,wght].ttf", weight: "400 700", style: "normal" }],
  display: "swap",
  variable: "--font-event-editorial",
});
