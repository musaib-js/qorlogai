import { Mail } from "lucide-react";
import Link from "next/link";

const CONTACT_EMAIL = "hello@qorlog.ai";
const LINKEDIN_URL = "https://www.linkedin.com";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "How it works", href: "/#preview" },
      { label: "Telegram", href: "/#features" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Get started", href: "/register" },
    ],
  },
  {
    title: "Company",
    links: [{ label: "Contact", href: `mailto:${CONTACT_EMAIL}` }],
  },
];

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}

const iconButton =
  "grid size-10 place-items-center rounded-xl border bg-card/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function Footer() {
  return (
    <footer className="overflow-hidden border-t">
      <div className="mx-auto max-w-6xl px-5 pt-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_2fr] lg:gap-16">
          <div>
            <p className="max-w-xs text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
              Timesheets that <span className="text-gradient">fill themselves</span>, wherever you chat.
            </p>
            <div className="mt-6 flex gap-3">
              <a href={LINKEDIN_URL} target="_blank" rel="noreferrer noopener" aria-label="LinkedIn" className={iconButton}>
                <LinkedInIcon className="size-4" />
              </a>
              <a href={`mailto:${CONTACT_EMAIL}`} aria-label="Email" className={iconButton}>
                <Mail className="size-4" />
              </a>
            </div>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h4 className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">{col.title}</h4>
                <ul className="mt-5 space-y-3.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="text-[0.95rem] text-foreground/80 transition-colors hover:text-foreground">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Oversized wordmark: font-size scales with the viewport so it always fills the width */}
        <div
          aria-hidden
          className="mt-14 text-center leading-none font-bold tracking-tighter whitespace-nowrap select-none sm:mt-20"
          style={{ fontSize: "clamp(3rem, 17.5vw, 15rem)", paddingBottom: "0.12em" }}
        >
          <span className="footer-wordmark">Qorlog.ai</span>
        </div>

        <div className="flex flex-col gap-2 border-t py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Qorlog AI. All rights reserved.</p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-mono transition-colors hover:text-foreground">
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
