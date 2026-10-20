/** Timezone + date helpers. Everything works on ISO dates (yyyy-mm-dd) in the user's local zone. */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localParts(tz: string, now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
    weekday: WEEKDAYS.indexOf(get("weekday")), // 0 = Sunday
  };
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso: string): number {
  return toUtc(iso).getUTCDay();
}

export function weekdayName(iso: string): string {
  return WEEKDAYS_LONG[weekdayOf(iso)];
}

export function isWeekend(iso: string): boolean {
  const w = weekdayOf(iso);
  return w === 0 || w === 6;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Inclusive list of ISO dates between two dates (capped to avoid runaway ranges). */
export function dateRange(from: string, to: string, cap = 370): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to && out.length < cap) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** "Tue 2026-10-20 (today)" lines for the last N days: models are bad at calendar arithmetic. */
export function recentCalendar(tz: string, days = 14, now: Date = new Date()): string {
  const today = localParts(tz, now).date;
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    lines.push(`${WEEKDAYS[weekdayOf(d)]} ${d}${i === 0 ? " (today)" : i === 1 ? " (yesterday)" : ""}`);
  }
  return lines.join("\n");
}

/** Formats an ISO date using tokens: YYYY YY MMMM MMM MM M DDDD DDD DD D (dddd/ddd = weekday names). */
export function formatDate(iso: string, fmt: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = weekdayOf(iso);
  const map: Record<string, string> = {
    YYYY: String(y),
    YY: String(y).slice(-2),
    MMMM: MONTHS_LONG[m - 1],
    MMM: MONTHS[m - 1],
    MM: String(m).padStart(2, "0"),
    M: String(m),
    dddd: WEEKDAYS_LONG[wd],
    ddd: WEEKDAYS[wd],
    DD: String(d).padStart(2, "0"),
    D: String(d),
  };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D/g, (t) => map[t]);
}

export type DateOrder = "DMY" | "MDY" | "YMD";

/** Infers the day/month order of a format string like "DD/MM/YYYY". */
export function orderFromFormat(fmt: string | null | undefined): DateOrder {
  if (!fmt) return "DMY";
  const di = fmt.search(/D/);
  const mi = fmt.search(/M/);
  const yi = fmt.search(/Y/);
  if (yi >= 0 && yi < di && yi < mi) return "YMD";
  return mi >= 0 && mi < di ? "MDY" : "DMY";
}

function monthFromName(s: string): number {
  const k = s.slice(0, 3).toLowerCase();
  return MONTHS.findIndex((m) => m.toLowerCase() === k) + 1;
}

/** Parses whatever a spreadsheet cell holds into an ISO date, or null. */
export function parseCellDate(cell: unknown, order: DateOrder = "DMY"): string | null {
  if (cell == null || cell === "") return null;
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? null : cell.toISOString().slice(0, 10);
  }
  if (typeof cell === "number") {
    // Excel serial date (1900 system)
    if (cell > 20000 && cell < 80000) {
      const ms = Math.round((cell - 25569) * 86400 * 1000);
      return new Date(ms).toISOString().slice(0, 10);
    }
    return null;
  }
  const s = String(cell).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return build(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    if (order === "MDY") [a, b] = [b, a];
    // If the preferred order is impossible, try the other one.
    return build(y, b, a) ?? build(y, a, b);
  }

  // "20 Oct 2026", "20-Oct-26", "Tue, 20 Oct 2026"
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-/,]+([A-Za-z]{3,9})[\s\-/,]+(\d{2,4})/);
  if (m && monthFromName(m[2])) return build(+m[3] < 100 ? 2000 + +m[3] : +m[3], monthFromName(m[2]), +m[1]);

  // "Oct 20, 2026"
  m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/);
  if (m && monthFromName(m[1])) return build(+m[3] < 100 ? 2000 + +m[3] : +m[3], monthFromName(m[1]), +m[2]);

  return null;
}

function build(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

/** Month/year mentioned in a sheet tab name ("Oct 2026", "October-26", "2026-10", "10/2026"). */
export function parseMonthFromTabName(name: string): string | null {
  let m = name.match(/(\d{4})[-_/ ](\d{1,2})\b/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
  m = name.match(/\b(\d{1,2})[-_/ ](\d{4})\b/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${String(m[1]).padStart(2, "0")}`;
  m = name.match(/([A-Za-z]{3,9})[\s\-_,.']*(\d{2,4})/);
  if (m && monthFromName(m[1])) {
    const y = +m[2] < 100 ? 2000 + +m[2] : +m[2];
    return `${y}-${String(monthFromName(m[1])).padStart(2, "0")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Timezone resolution from free text ("Kolkata", "IST", "+05:30", "new york")
// ---------------------------------------------------------------------------------------------

const TZ_ALIASES: Record<string, string> = {
  ist: "Asia/Kolkata", india: "Asia/Kolkata", mumbai: "Asia/Kolkata", delhi: "Asia/Kolkata", "new delhi": "Asia/Kolkata",
  bangalore: "Asia/Kolkata", bengaluru: "Asia/Kolkata", hyderabad: "Asia/Kolkata", chennai: "Asia/Kolkata",
  pune: "Asia/Kolkata", bombay: "Asia/Kolkata", calcutta: "Asia/Kolkata", kolkata: "Asia/Kolkata",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pacific: "America/Los_Angeles",
  est: "America/New_York", edt: "America/New_York", eastern: "America/New_York", "new york": "America/New_York",
  mst: "America/Denver", mdt: "America/Denver", cdt: "America/Chicago",
  gmt: "UTC", utc: "UTC", bst: "Europe/London", uk: "Europe/London", london: "Europe/London",
  cet: "Europe/Berlin", cest: "Europe/Berlin", sgt: "Asia/Singapore", singapore: "Asia/Singapore",
  jst: "Asia/Tokyo", japan: "Asia/Tokyo", aest: "Australia/Sydney", aedt: "Australia/Sydney",
  gst: "Asia/Dubai", uae: "Asia/Dubai", dubai: "Asia/Dubai", pkt: "Asia/Karachi", sast: "Africa/Johannesburg",
};

const OFFSETS: Record<string, string> = {
  "-8": "America/Los_Angeles", "-7": "America/Denver", "-6": "America/Chicago", "-5": "America/New_York",
  "0": "UTC", "1": "Europe/Berlin", "2": "Europe/Athens", "3": "Europe/Moscow", "4": "Asia/Dubai",
  "5": "Asia/Karachi", "5.5": "Asia/Kolkata", "5.75": "Asia/Kathmandu", "6": "Asia/Dhaka", "7": "Asia/Bangkok",
  "8": "Asia/Singapore", "9": "Asia/Tokyo", "9.5": "Australia/Adelaide", "10": "Australia/Sydney", "12": "Pacific/Auckland",
};

let tzList: string[] | null = null;
function allZones(): string[] {
  if (!tzList) {
    try {
      tzList = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      tzList = [];
    }
  }
  return tzList;
}

export function resolveTimezoneLocal(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 60) return null;
  const lower = raw.toLowerCase().replace(/\s+/g, " ");

  if (TZ_ALIASES[lower]) return TZ_ALIASES[lower];

  // Exact IANA (case-insensitive)
  if (raw.includes("/")) {
    const canon = raw
      .split("/")
      .map((p) => p.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("_"))
      .join("/");
    if (isValidTimezone(canon)) return canon;
    const hit = allZones().find((z) => z.toLowerCase() === lower.replace(/ /g, "_"));
    if (hit) return hit;
  }

  // UTC offsets: "+05:30", "UTC+5:30", "GMT-8"
  const off = lower.match(/^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/);
  if (off) {
    const hours = Number(off[2]) + (off[3] ? Number(off[3]) / 60 : 0);
    const val = String(off[1] === "-" ? -hours : hours);
    if (OFFSETS[val]) return OFFSETS[val];
    return null;
  }

  // City name -> last path segment
  const city = lower.replace(/ /g, "_");
  const byCity = allZones().filter((z) => z.split("/").pop()!.toLowerCase() === city);
  if (byCity.length === 1) return byCity[0];

  return null;
}

export function listTimezones(): string[] {
  const zones = allZones();
  return zones.length ? zones : ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles"];
}
