import type { Metadata } from "next";
import { Suspense } from "react";
import Script from "next/script";
import "./globals.css";
import AuthProvider from "@/components/providers/AuthProvider";
import DomainTheme from "@/components/providers/DomainTheme";
import { DomainSwitchProvider } from "@/components/providers/DomainSwitchAnimation";
import { UserActivityTracker } from "@/components/analytics/UserActivityTracker";

export const metadata: Metadata = {
  title: "ESG Credit Rating",
  description: "Article portal for ESG and Credit content",
};

const removeInjectedFormAttributes = `
(() => {
  const attributeName = "fdprocessedid";

  function removeFrom(root) {
    if (!root) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.hasAttribute?.(attributeName)) {
      root.removeAttribute(attributeName);
    }

    root.querySelectorAll?.("[" + attributeName + "]").forEach((element) => {
      element.removeAttribute(attributeName);
    });
  }

  removeFrom(document);

  if (typeof MutationObserver === "undefined" || !document.documentElement) return;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        mutation.target.removeAttribute?.(attributeName);
      }

      mutation.addedNodes.forEach(removeFrom);
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [attributeName],
    childList: true,
    subtree: true,
  });

  window.addEventListener(
    "load",
    () => {
      window.setTimeout(() => {
        observer.disconnect();
        removeFrom(document);
      }, 5000);
    },
    { once: true },
  );
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="remove-injected-form-attributes"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: removeInjectedFormAttributes }}
        />
        <AuthProvider>
          <DomainSwitchProvider>
            <DomainTheme>
              <Suspense fallback={null}>
                <UserActivityTracker />
              </Suspense>
              {children}
            </DomainTheme>
          </DomainSwitchProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
