import Image from "next/image";

import { cn } from "@/lib/utils";

// The artwork is dark on white, so on the dark theme it sits on a white chip to stay legible.
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-white", className)}>
      <Image src="/logo-mark.png" alt="Qorlog AI" width={256} height={256} className="size-full object-contain" />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-lg dark:bg-white dark:px-2 dark:py-1", className)}>
      <Image src="/logo.png" alt="Qorlog AI" width={1990} height={480} priority className="h-8 w-auto" />
    </span>
  );
}
