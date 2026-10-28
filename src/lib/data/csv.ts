import Papa from "papaparse";

/**
 * CSV ingestion: validate and parse into a header + string rows.
 * Pure (no I/O), so the same code runs in tests and on the server.
 */

export const CSV_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 100,
};

export class CsvError extends Error {}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  /** Non-fatal problems the user should see (e.g. ragged rows that were padded). */
  warnings: string[];
  /** Normalised text (BOM stripped, LF line endings) — what the dataset hash is computed from. */
  normalized: string;
}

export function normalizeCsvText(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

export function parseCsv(input: string): ParsedCsv {
  if (input.length > CSV_LIMITS.maxBytes) throw new CsvError("CSV is larger than 5 MB");
  if (input.includes("\u0000")) throw new CsvError("This looks like a binary file, not a CSV");
  const normalized = normalizeCsvText(input);
  if (!normalized.trim()) throw new CsvError("The file is empty");

  const result = Papa.parse<string[]>(normalized, { skipEmptyLines: "greedy" });
  const fatal = result.errors.find((e) => e.type === "Delimiter" && result.data.length === 0);
  if (fatal) throw new CsvError(`Could not parse CSV: ${fatal.message}`);

  const [rawHeader, ...body] = result.data;
  if (!rawHeader || rawHeader.every((h) => !h.trim())) throw new CsvError("Missing header row");
  if (rawHeader.length > CSV_LIMITS.maxColumns) throw new CsvError(`Too many columns (${rawHeader.length}; max ${CSV_LIMITS.maxColumns})`);
  if (body.length === 0) throw new CsvError("The CSV has a header but no data rows");
  if (body.length > CSV_LIMITS.maxRows) throw new CsvError(`Too many rows (${body.length}; max ${CSV_LIMITS.maxRows})`);

  const warnings: string[] = [];

  // Blank or duplicate headers get unique, readable names.
  const seen = new Map<string, number>();
  const headers = rawHeader.map((h, i) => {
    let name = h.trim() || `Column ${i + 1}`;
    const n = seen.get(name.toLowerCase()) ?? 0;
    seen.set(name.toLowerCase(), n + 1);
    if (n > 0) {
      name = `${name} (${n + 1})`;
      warnings.push(`Duplicate column name renamed to "${name}"`);
    }
    return name;
  });

  let ragged = 0;
  const rows = body.map((r) => {
    if (r.length !== headers.length) ragged++;
    const row = r.slice(0, headers.length).map((v) => v.trim());
    while (row.length < headers.length) row.push("");
    return row;
  });
  if (ragged) warnings.push(`${ragged} row${ragged === 1 ? "" : "s"} had a different number of fields and ${ragged === 1 ? "was" : "were"} padded or trimmed`);

  return { headers, rows, warnings, normalized };
}
