// Import global styles and fonts
import "@/app/global.css";
import { Geist } from "next/font/google";
import type { Metadata } from "next";

const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "404 - Page Not Found",
  description: "The page you are looking for does not exist.",
};

export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="h-full">
        <>
          {/*
        This example requires updating your template:

        ```
        <html class="h-full">
        <body class="h-full">
        ```
      */}
          <main className="grid min-h-full place-items-center bg-fd-background px-6 py-24 sm:py-32 lg:px-8">
            <div className="text-center">
              <p className="text-base font-semibold text-fd-primary">404</p>
              <h1 className="mt-4 text-5xl font-semibold tracking-tight text-balance text-fd-foreground sm:text-7xl">
                Page not found
              </h1>
              <p className="mt-6 text-lg font-medium text-pretty text-fd-muted-foreground sm:text-xl/8">
                Sorry, we couldn't find the page you're looking for.
              </p>
              <div className="mt-10 flex items-center justify-center gap-x-6">
                <a
                  href="/"
                  className="rounded-full bg-fd-primary px-3.5 py-2.5 text-sm font-semibold text-fd-primary-foreground shadow-xs hover:bg-fd-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
                >
                  Go back home
                </a>
                <a href="/docs" className="text-sm font-semibold text-fd-foreground hover:text-fd-primary transition-colors">
                  Browse docs <span aria-hidden="true">&rarr;</span>
                </a>
              </div>
            </div>
          </main>
        </>
      </body>
    </html>
  );
}
