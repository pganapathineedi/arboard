import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARBoard — Salesforce Architecture Review Board",
  description: "Enterprise Salesforce architecture review powered by Claude AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#07090f] antialiased">{children}</body>
    </html>
  );
}
