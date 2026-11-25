import { describe, expect, it } from "vitest";
import { detectColumns, normalizeStatus, parseCsv, phoneKey, rowToContact, toCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("parses quoted fields with commas, escaped quotes and newlines", () => {
    const rows = parseCsv('name,note\r\n"Levi, Noa","said ""hi""\nthen left"\r\nUri,ok\r\n');
    expect(rows).toEqual([
      ["name", "note"],
      ["Levi, Noa", 'said "hi"\nthen left'],
      ["Uri", "ok"],
    ]);
  });

  it("strips the Excel BOM and skips blank lines", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("detects semicolon-separated files from the header", () => {
    expect(parseCsv("שם;טלפון\nנועה;050-1234567")).toEqual([
      ["שם", "טלפון"],
      ["נועה", "050-1234567"],
    ]);
  });

  it("keeps quotes that appear mid-field (Hebrew abbreviations like בע\"מ)", () => {
    expect(parseCsv('company\nבית תוכנה בע"מ')[1]).toEqual(['בית תוכנה בע"מ']);
  });

  it("keeps a trailing empty field", () => {
    expect(parseCsv("a,b,\n1,2,")[1]).toEqual(["1", "2", ""]);
  });
});

describe("toCsv", () => {
  it("round-trips through parseCsv", () => {
    const rows = [["Levi, Noa", 'say "hi"', null, ["VIP", "North"]]];
    const csv = toCsv(["a", "b", "c", "d"], rows);
    expect(parseCsv(csv)[1]).toEqual(["Levi, Noa", 'say "hi"', "", "VIP, North"]);
  });

  it("neutralizes spreadsheet formulas but leaves phone numbers alone", () => {
    const csv = toCsv(["x"], [["=HYPERLINK(\"evil\")"], ["@SUM(A1)"], ["+972 52 765 4321"], ["-5"]]);
    const values = parseCsv(csv).slice(1).map((r) => r[0]);
    expect(values).toEqual(["'=HYPERLINK(\"evil\")", "'@SUM(A1)", "+972 52 765 4321", "-5"]);
  });

  it("starts with a BOM so Excel reads Hebrew as UTF-8", () => {
    expect(toCsv(["שם"], []).charCodeAt(0)).toBe(0xfeff);
  });
});

describe("column mapping", () => {
  it("recognizes Hebrew and English headers", () => {
    expect(detectColumns(["שם פרטי", "Last Name", "E-mail", "נייד", "חברה", "unknown"])).toEqual([
      "firstName",
      "lastName",
      "email",
      "phone",
      "company",
      null,
    ]);
  });

  it("does not map two columns to the same field", () => {
    expect(detectColumns(["email", "Email"])).toEqual(["email", null]);
  });

  it("splits a full name when there is no first-name column", () => {
    const map = detectColumns(["שם מלא", "אימייל"]);
    expect(rowToContact(["נועה בת שבע לוי", "n@example.com"], map)).toMatchObject({
      firstName: "נועה",
      lastName: "בת שבע לוי",
      email: "n@example.com",
    });
  });

  it("normalizes statuses in both languages", () => {
    expect(normalizeStatus("לקוח")).toBe("customer");
    expect(normalizeStatus("Prospect")).toBe("prospect");
    expect(normalizeStatus("something")).toBeUndefined();
  });
});

describe("phoneKey", () => {
  it("treats local and international Israeli formats as the same number", () => {
    expect(phoneKey("+972 52-765-4321")).toBe(phoneKey("052-7654321"));
  });
  it("ignores values too short to be a phone", () => {
    expect(phoneKey("123")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});
