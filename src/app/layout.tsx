import type { Metadata } from "next";
import { Figtree, Syne } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";
import { LogoutLink } from "@/components/LogoutLink";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Failure AI OAuth",
  description:
    "Universal PKCE OAuth for apps — connect Codex, ChatGPT, Claude Code, and Grok Build.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className={`${syne.variable} ${figtree.variable} h-full`}>
      <body className="min-h-full">
        <div className="site-shell">
          <header className="site-nav">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden />
              Failure
            </Link>
            <nav className="nav-links">
              <Link href="/developers">Developers</Link>
              {user ? (
                <>
                  <Link href="/dashboard">Dashboard</Link>
                  <Link href="/dashboard/chat">Chat</Link>
                  <Link href="/account/providers">Providers</Link>
                  <LogoutLink />
                </>
              ) : (
                <>
                  <Link href="/login">Sign in</Link>
                  <Link href="/signup">Sign up</Link>
                </>
              )}
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
