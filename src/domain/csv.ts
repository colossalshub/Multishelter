const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map((header) => csvCell(header)).join(",")];
  for (const row of rows) lines.push(row.map((cell) => csvCell(cell)).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
