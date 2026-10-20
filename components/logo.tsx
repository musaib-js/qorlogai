import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-xl bg-gradient-brand text-white shadow-sm", className)}>
      <Sparkles className="size-4" />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-lg">
        Qorlog <span className="text-gradient">AI</span>
      </span>
    </span>
  );
}
