import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/providers/AuthProvider";
import DomainTheme from "@/components/providers/DomainTheme";
import { DomainSwitchProvider } from "@/components/providers/DomainSwitchAnimation";

export const metadata: Metadata = {
  title: "ESG Credit Rating",
  description: "Article portal for ESG and Credit content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AuthProvider>
          <DomainSwitchProvider>
            <DomainTheme>{children}</DomainTheme>
          </DomainSwitchProvider>
        </AuthProvider>
      </body>
    </html>
  );
}