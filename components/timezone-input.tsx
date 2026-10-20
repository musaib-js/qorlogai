"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";

/** Searchable timezone field: type "Kolk" and pick Asia/Kolkata. Defaults to the browser's zone. */
export function TimezoneInput({ zones, defaultValue, name = "timezone", id = "timezone" }: { zones: string[]; defaultValue?: string; name?: string; id?: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  useEffect(() => {
    if (!defaultValue) {
      try {
        setValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
      } catch {
        /* leave empty */
      }
    }
  }, [defaultValue]);
  return (
    <>
      <Input id={id} name={name} list={`${id}-list`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Asia/Kolkata" autoComplete="off" required />
      <datalist id={`${id}-list`}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}
