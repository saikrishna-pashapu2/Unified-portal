import localFont from "next/font/local";

/** Local copies of the admin event-alert ledger's selected font weights. */
export const ledgerSans = localFont({
  src: [{ path: "./IBMPlexSans[wdth,wght].ttf", weight: "400 600", style: "normal" }],
  display: "swap",
  variable: "--font-event-alert-sans",
});

export const ledgerEditorial = localFont({
  src: [{ path: "./Newsreader[opsz,wght].ttf", weight: "400 700", style: "normal" }],
  display: "swap",
  variable: "--font-event-alert-editorial",
});
