import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "@/lib/data/csv";
import { formatValue, renderTemplate } from "@/lib/data/format";
import { isMissing, parseDate, parseNumber, profileTable } from "@/lib/data/profile";
import { aggregate, computeCalc } from "@/lib/data/stats";

const SALES = `date,region,product,units,revenue
2024-01-05,North,Widget,10,"1,000.50"
2024-01-20,South,Widget,5,$500
2024-02-03,North,Gadget,8,800
2024-02-17,East,Gadget,,NA
2024-03-02,South,Widget,12,1200
2024-03-28,North,Gizmo,4,400
`;

const table = () => {
  const p = parseCsv(SALES);
  return profileTable(p.headers, p.rows);
};

describe("CSV parsing and validation", () => {
  it("parses headers and rows, stripping BOM and CRLF", () => {
    const p = parseCsv("﻿a,b\r\n1,2\r\n3,4\r\n");
    expect(p.headers).toEqual(["a", "b"]);
    expect(p.rows).toEqual([["1", "2"], ["3", "4"]]);
    expect(p.normalized).toBe("a,b\n1,2\n3,4\n");
  });

  it("renames blank/duplicate headers and pads ragged rows with warnings", () => {
    const p = parseCsv("a,a,\n1,2,3\n4\n");
    expect(p.headers).toEqual(["a", "a (2)", "Column 3"]);
    expect(p.rows[1]).toEqual(["4", "", ""]);
    expect(p.warnings.join(" ")).toMatch(/Duplicate/);
    expect(p.warnings.join(" ")).toMatch(/1 row had a different number of fields/);
  });

  it("rejects empty, header-only, binary and oversize input", () => {
    expect(() => parseCsv("")).toThrow(CsvError);
    expect(() => parseCsv("a,b\n")).toThrow(/no data rows/);
    expect(() => parseCsv("a,b\n1\u00002,3")).toThrow(/binary/);
    expect(() => parseCsv("a\n" + "1\n".repeat(3 * 1024 * 1024))).toThrow(/larger than 5 MB/);
  });
});

describe("value parsing and column typing", () => {
  it("parses formatted numbers and detects units", () => {
    expect(parseNumber("1,234.5")).toEqual({ value: 1234.5 });
    expect(parseNumber("$12")).toEqual({ value: 12, unit: "$" });
    expect(parseNumber("45%")).toEqual({ value: 45, unit: "%" });
    expect(parseNumber("12abc")).toBeNull();
    expect(parseNumber("1,23")).toBeNull();
  });

  it("validates dates strictly", () => {
    expect(parseDate("2024-2-3")).toBe("2024-02-03");
    expect(parseDate("2024/12")).toBe("2024-12");
    expect(parseDate("2024-02-30")).toBeNull();
    expect(parseDate("2024-13-01")).toBeNull();
  });

  it("treats common placeholders as missing", () => {
    for (const v of ["", " ", "NA", "n/a", "null", "-", "NaN"]) expect(isMissing(v)).toBe(true);
    expect(isMissing("0")).toBe(false);
  });

  it("infers types, missing counts, order and units", () => {
    const t = table();
    const by = Object.fromEntries(t.columns.map((c) => [c.profile.name, c.profile]));
    expect(by.date).toMatchObject({ type: "date", ordered: true, first: "2024-01-05", last: "2024-03-28" });
    expect(by.region).toMatchObject({ type: "categorical", distinct: 3 });
    expect(by.units).toMatchObject({ type: "numeric", missing: 1, min: 4, max: 12 });
    expect(by.revenue).toMatchObject({ type: "numeric", missing: 1, unit: "$" });
  });

  it("flags identifier columns", () => {
    const rows = Array.from({ length: 30 }, (_, i) => [String(1000 + i), String((i * 7) % 5), String(i + 1), String((i * 37) % 100)]);
    const t = profileTable(["order_id", "qty", "n", "score"], rows);
    expect(t.columns.map((c) => c.profile.likelyId)).toEqual([true, false, true, false]); // unique scores are not ids
  });
});

describe("deterministic statistics", () => {
  it("aggregates excluding missing values", () => {
    const t = table();
    expect(computeCalc(t, { op: "rowCount" })).toEqual({ kind: "scalar", value: 6 });
    expect(computeCalc(t, { op: "aggregate", agg: "sum", column: "revenue" })).toEqual({ kind: "scalar", value: 3900.5 });
    expect(computeCalc(t, { op: "aggregate", agg: "mean", column: "revenue" })).toEqual({ kind: "scalar", value: 780.1 });
    expect(computeCalc(t, { op: "aggregate", agg: "count", column: "units" })).toEqual({ kind: "scalar", value: 5 });
    expect(aggregate([], "mean")).toBe(0);
  });

  it("groups, sorts with stable tie-breaks, and limits", () => {
    const t = table();
    expect(computeCalc(t, { op: "groupBy", by: "region", measure: "revenue", agg: "sum", sort: "desc", limit: 10 })).toEqual({
      kind: "series",
      points: [
        { label: "North", value: 2200.5 },
        { label: "South", value: 1700 },
        { label: "East", value: 0 },
      ],
    });
    expect(computeCalc(t, { op: "groupBy", by: "product", agg: "count", sort: "desc", limit: 2 })).toEqual({
      kind: "series",
      points: [
        { label: "Widget", value: 3 },
        { label: "Gadget", value: 2 },
      ],
    });
  });

  it("computes the top group's share", () => {
    const r = computeCalc(table(), { op: "topShare", by: "region", measure: "revenue" });
    expect(r).toMatchObject({ kind: "scalar", label: "North" });
    expect(r.kind === "scalar" && r.value).toBeCloseTo((2200.5 / 3900.5) * 100, 8);
  });

  it("buckets daily dates to months for trends and computes change", () => {
    const t = table();
    // 6 distinct days fits in 24 points, so the trend stays daily.
    expect(computeCalc(t, { op: "trend", x: "date", measure: "revenue", agg: "sum" }).kind).toBe("series");
    const many = profileTable(
      ["day", "v"],
      Array.from({ length: 90 }, (_, i) => [new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), "1"]),
    );
    const tr = computeCalc(many, { op: "trend", x: "day", measure: "v", agg: "sum" });
    expect(tr).toEqual({ kind: "series", points: [{ label: "2024-01", value: 31 }, { label: "2024-02", value: 29 }, { label: "2024-03", value: 30 }] });
    const ch = computeCalc(many, { op: "trendChange", x: "day", measure: "v", agg: "sum" });
    expect(ch).toMatchObject({ kind: "scalar", detail: { from: "2024-01", to: "2024-03", fromValue: 31, toValue: 30 } });
    expect(ch.kind === "scalar" && ch.value).toBeCloseTo(((30 - 31) / 31) * 100, 8);
  });

  it("builds an equal-width histogram that counts every value", () => {
    const t = profileTable(["x"], Array.from({ length: 100 }, (_, i) => [String(i)]));
    const h = computeCalc(t, { op: "histogram", column: "x", bins: 5 });
    expect(h.kind === "series" && h.points.map((p) => p.value)).toEqual([20, 20, 20, 20, 20]);
  });

  it("is deterministic and rejects invalid columns", () => {
    const spec = { op: "groupBy", by: "region", measure: "revenue", agg: "mean", sort: "desc", limit: 5 } as const;
    expect(JSON.stringify(computeCalc(table(), spec))).toBe(JSON.stringify(computeCalc(table(), spec)));
    expect(() => computeCalc(table(), { op: "aggregate", agg: "sum", column: "region" })).toThrow(/not numeric/);
    expect(() => computeCalc(table(), { op: "aggregate", agg: "sum", column: "nope" })).toThrow(/Unknown column/);
  });
});

describe("formatting", () => {
  it("formats values for display", () => {
    expect(formatValue(1234567, "compact", "$")).toBe("$1.2M");
    expect(formatValue(149757.6, "compact")).toBe("149.8K");
    expect(formatValue(3900.5, "decimal")).toBe("3,900.5");
    expect(formatValue(12.345, "signedPercent")).toBe("+12.3%");
    expect(renderTemplate("{0} leads with {1}", [56.42, 2200.5], ["percent", "integer"])).toBe("56.4% leads with 2,201");
  });
});
