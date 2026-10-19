export const DATE_FORMATS = ["yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yyyy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (year < 1900 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function formatCalendarDate(value: string | null | undefined, dateFormat: string): string {
  if (!value) return "";
  if (!isCalendarDate(value)) return value;
  const [year, month, day] = value.split("-");
  if (dateFormat === "MM/dd/yyyy") return `${month}/${day}/${year}`;
  if (dateFormat === "dd/MM/yyyy") return `${day}/${month}/${year}`;
  return value;
}

export function formatInstant(value: Date | string | null | undefined, timeZone: string, dateFormat: string): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const calendar = todayParts(date, timeZone);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatCalendarDate(calendar, dateFormat)} ${time}`;
}

function todayParts(date: Date, timeZone: string): string {
  return todayInTimeZone(timeZone, date);
}

export function formatMoney(cents: number | null | undefined, currency: string, locale: string): string {
  if (cents == null) return "";
  try {
    return new Intl.NumberFormat(locale || "en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
