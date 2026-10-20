"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Cpu, FileSpreadsheet, MessageSquare, Settings, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const ICONS = { chat: MessageSquare, sheets: FileSpreadsheet, settings: Settings, overview: BarChart3, users: Users, models: Cpu, bot: Bot };

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

export function NavLinks({ items, orientation = "vertical" }: { items: NavItem[]; orientation?: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex gap-1", orientation === "vertical" ? "flex-col" : "items-center overflow-x-auto")}>
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const active = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("size-4", active && "text-primary")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
