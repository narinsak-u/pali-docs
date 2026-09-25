import "@/app/global.css";
import { Provider } from "@/providers/RootProvider";
import { Metadata } from "next";
import {
  Thasadith,
  Geist,
  Geist_Mono,
  IBM_Plex_Sans_Thai,
} from "next/font/google";
import type { ReactNode } from "react";

const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const thasadith = Thasadith({
  subsets: ["thai"],
  display: "swap",
  weight: ["400", "700"],
});

const ibm = IBM_Plex_Sans_Thai({
  variable: "--font-ibm",
  subsets: ["thai", "latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Pali Docs",
  description: "Pali Docs is a documentation site for Pali language.",
  other: {
    // algolia verification
    "algolia-site-verification": "C43FA7A055938012",
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen" suppressHydrationWarning>
        <Provider>
          <div lang="th">{children}</div>
        </Provider>
      </body>
    </html>
  );
}
