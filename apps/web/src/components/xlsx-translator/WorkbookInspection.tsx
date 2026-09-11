"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  FileSpreadsheet,
  Languages,
  RefreshCw,
  Table2,
} from "lucide-react";
import styles from "./workbook-inspection.module.css";

type Props = { error?: string; onRetry: () => void };

export default function WorkbookInspection({ error, onRetry }: Props) {
  const [takingLonger, setTakingLonger] = useState(false);
  useEffect(() => {
    setTakingLonger(false);
    if (error) return;
    const timer = setTimeout(() => setTakingLonger(true), 12000);
    return () => clearTimeout(timer);
  }, [error]);

  return (
    <main
      className={styles.screen}
      data-state={error ? "error" : "loading"}
      aria-labelledby="workbook-inspection-title"
    >
      <nav className={styles.navigation} aria-label="Workbook navigation">
        <Link href="/esg/tools/pdf-translator-2" className={styles.back}>
          <ArrowLeft size={16} aria-hidden="true" /> Translation workspace
        </Link>
        <span className={styles.fileType}>
          <FileSpreadsheet size={15} aria-hidden="true" /> EXCEL
        </span>
      </nav>

      <section className={styles.workspace} aria-label="Workbook inspection">
        <div className={styles.copy}>
          <div className={styles.eyebrow}>
            <span />{" "}
            {error
              ? "LET’S TRY THAT AGAIN"
              : "A CLOSER LOOK, BEFORE YOU TRANSLATE"}
          </div>
          <h1 id="workbook-inspection-title" className={styles.title}>
            {error ? (
              <>
                Let’s take
                <br />
                <em>another look.</em>
              </>
            ) : (
              <>
                Inspecting your
                <br />
                <em>workbook.</em>
              </>
            )}
          </h1>
          <p className={styles.description}>
            {error
              ? "We couldn’t load the workbook preview. Retry inspection to open it again—this won’t start a translation."
              : "Finding worksheets, table regions and text languages, ready for you to choose what to translate."}
          </p>

          {error ? (
            <div className={styles.error}>
              <p role="alert">{error}</p>
              <button className={styles.retry} onClick={onRetry}>
                <RefreshCw size={16} aria-hidden="true" /> Retry inspection{" "}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className={styles.activity}>
              <span className={styles.dots} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <div role="status" aria-live="polite" aria-atomic="true">
                <p className={styles.activityTitle}>
                  {takingLonger
                    ? "Still inspecting your workbook"
                    : "Reading workbook structure"}
                </p>
                <p className={styles.activityNote}>
                  {takingLonger
                    ? "Larger workbooks can take a little longer."
                    : "Your preview will open here automatically."}
                </p>
              </div>
            </div>
          )}
          <p className={styles.assurance}>
            Inspection makes no translation API calls.
          </p>
        </div>

        <div className={styles.illustration} aria-hidden="true">
          <div className={styles.orbit} />
          <div className={styles.paperBack} />
          <div className={styles.paperMiddle} />
          <div className={styles.workbook}>
            <div className={styles.workbookHeader}>
              <span className={styles.workbookIcon}>
                <FileSpreadsheet size={21} />
              </span>
              <div>
                <span className={styles.workbookLabel}>WORKBOOK PREVIEW</span>
                <div className={styles.filenameLine} />
              </div>
              <span className={styles.windowDots}>···</span>
            </div>
            <div className={styles.formulaBar}>
              <span>fx</span>
              <div />
            </div>
            <div className={styles.grid}>
              <div className={styles.columnHeaders}>
                <span />
                {["A", "B", "C", "D", "E"].map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              {Array.from({ length: 7 }, (_, row) => (
                <div key={row} className={styles.gridRow}>
                  <span className={styles.rowNumber}>{row + 1}</span>
                  {Array.from({ length: 5 }, (_, col) => (
                    <span
                      className={`${styles.cell} ${row === 0 ? styles.headerCell : ""} ${row >= 2 && row <= 4 && col >= 1 && col <= 3 ? styles.focusCell : ""}`}
                      key={col}
                    >
                      <span
                        className={styles.cellLine}
                        style={
                          {
                            "--line-width": `${35 + ((row * 17 + col * 23) % 45)}%`,
                            "--line-delay": `${row * 0.18}s`,
                          } as CSSProperties
                        }
                      />
                    </span>
                  ))}
                </div>
              ))}
              <div className={styles.selection}>
                <span />
              </div>
              <div
                className={styles.scan}
                data-testid="workbook-inspection-scan"
              />
            </div>
            <div className={styles.sheetTabs}>
              <Table2 size={13} />
              <span />
              <span />
              <span />
              <b>+</b>
            </div>
          </div>
          <div className={styles.tableTag}>
            <span>
              <Table2 size={17} />
            </span>{" "}
            Sheets &amp; tables
          </div>
          <div className={styles.languageTag}>
            <span>
              <Languages size={17} />
            </span>{" "}
            Text &amp; languages
          </div>
        </div>

        <footer className={styles.footer}>
          <span className={styles.footerNumber}>NEXT</span>
          <p>
            Choose a worksheet, a table, or just a few cells.
            <br />
            <span>You’re in control of what gets translated.</span>
          </p>
          <ArrowRight size={21} aria-hidden="true" />
        </footer>
      </section>
    </main>
  );
}
