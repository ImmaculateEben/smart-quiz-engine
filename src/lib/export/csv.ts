export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]) {
  const headers = columns && columns.length > 0 ? columns : inferColumns(rows);
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(","))
  ];
  return lines.join("\r\n");
}

function inferColumns(rows: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen];
}

function escapeCsvCell(value: unknown) {
  if (value == null) return "";
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
