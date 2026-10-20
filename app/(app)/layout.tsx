import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/actions";
import { Logo } from "@/components/logo";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { requireUser } from "@/lib/session";

const MAIN: NavItem[] = [
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/timesheets", label: "Timesheets", icon: "sheets" },
  { href: "/settings", label: "Settings", icon: "settings" },
];
const ADMIN: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "overview" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/models", label: "Model catalog", icon: "models" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {/* desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <Logo className="px-2 pb-6" />
        <NavLinks items={MAIN} />
        {isAdmin && (
          <>
            <Separator className="my-4" />
            <p className="px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Admin</p>
            <NavLinks items={ADMIN} />
          </>
        )}
        <div className="mt-auto flex items-center gap-3 rounded-xl border bg-card p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-brand text-sm font-semibold text-white">{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.timezone}</p>
          </div>
          <ThemeToggle />
          <form action={logoutAction}>
            <Button variant="ghost" size="icon-sm" aria-label="Sign out" type="submit">
              <LogOut className="size-4" />
            </Button>
          </form>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="flex items-center justify-between gap-2 border-b bg-sidebar px-3 py-2 md:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action={logoutAction}>
            <Button variant="ghost" size="icon-sm" aria-label="Sign out" type="submit">
              <LogOut className="size-4" />
            </Button>
          </form>
        </div>
      </header>
      <div className="border-b bg-sidebar px-2 py-1.5 md:hidden">
        <NavLinks items={isAdmin ? [...MAIN, ...ADMIN] : MAIN} orientation="horizontal" />
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
