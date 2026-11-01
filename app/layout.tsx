import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

const display = Fraunces({ variable: "--font-display", subsets: ["latin"], display: "swap" });
const body = Inter({ variable: "--font-body", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "MS Virtual Academy", template: "%s · MS Virtual Academy" },
  description: "MS Virtual Academy is an invite-only learning portal: tutor-led classes, a quiz after every session, and a certificate on completion.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-navy focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to main content
        </a>
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  );
}
