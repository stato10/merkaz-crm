/**
 * RFC 4180 CSV parsing and writing. Pure functions, shared by the import
 * preview in the browser and the import action on the server.
 */

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; // strip BOM (Excel)
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Excel in Hebrew/European locales often saves with `;`. Look at the header line only. */
function detectDelimiter(text: string) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const best = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  return count(best) > 0 ? best : ",";
}

function escapeField(v: unknown) {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join(", ") : v instanceof Date ? v.toISOString() : String(v);
  // Neutralize spreadsheet formula injection (=, +, -, @ at the start).
  // Plain numbers and phone numbers (+972 …) are left alone.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]) {
  // BOM so Excel opens Hebrew as UTF-8.
  return "﻿" + [headers, ...rows].map((r) => r.map(escapeField).join(",")).join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ */
/* Contact import column mapping                                       */
/* ------------------------------------------------------------------ */

export const contactFields = [
  "firstName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "title",
  "company",
  "status",
  "source",
  "tags",
] as const;
export type ContactField = (typeof contactFields)[number];

const aliases: Record<ContactField, string[]> = {
  firstName: ["first name", "firstname", "first", "given name", "שם פרטי", "פרטי"],
  lastName: ["last name", "lastname", "surname", "family name", "שם משפחה", "משפחה"],
  fullName: ["name", "full name", "contact", "contact name", "שם", "שם מלא", "איש קשר"],
  email: ["email", "e-mail", "mail", "email address", "אימייל", "מייל", "דוא\"ל", "דואל", "דואר אלקטרוני"],
  phone: ["phone", "mobile", "telephone", "tel", "cell", "phone number", "טלפון", "נייד", "פלאפון", "סלולרי"],
  title: ["title", "job title", "position", "role", "תפקיד"],
  company: ["company", "organization", "account", "company name", "חברה", "ארגון", "שם חברה"],
  status: ["status", "lifecycle stage", "stage", "סטטוס", "מצב"],
  source: ["source", "lead source", "מקור", "מקור ליד"],
  tags: ["tags", "labels", "תגיות", "תוויות"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

/** Map each CSV column index to a contact field by its header, or null when unknown. */
export function detectColumns(headers: string[]): (ContactField | null)[] {
  const used = new Set<ContactField>();
  return headers.map((h) => {
    const n = norm(h);
    const field = contactFields.find((f) => !used.has(f) && (f === n || aliases[f].some((a) => norm(a) === n)));
    if (field) used.add(field);
    return field ?? null;
  });
}

const statusAliases: Record<string, "lead" | "prospect" | "customer" | "churned"> = {
  lead: "lead",
  "ליד": "lead",
  prospect: "prospect",
  "מתעניין": "prospect",
  "בתהליך": "prospect",
  customer: "customer",
  client: "customer",
  "לקוח": "customer",
  churned: "churned",
  lost: "churned",
  "עזב": "churned",
  "לשעבר": "churned",
};

export function normalizeStatus(v: string | undefined) {
  if (!v) return undefined;
  return statusAliases[v.trim().toLowerCase()];
}

/** Turn a parsed row into contact fields using the detected mapping. */
export function rowToContact(row: string[], mapping: (ContactField | null)[]) {
  const out: Partial<Record<ContactField, string>> = {};
  mapping.forEach((f, i) => {
    const v = row[i]?.trim();
    if (f && v) out[f] = v;
  });
  if (!out.firstName && out.fullName) {
    const [first, ...rest] = out.fullName.split(/\s+/);
    out.firstName = first;
    out.lastName ??= rest.join(" ");
  }
  return out;
}

/** Comparable phone key: digits only, Israeli +972 folded to a leading 0. */
export function phoneKey(p: string | null | undefined) {
  if (!p) return null;
  let d = p.replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  return d.length >= 7 ? d : null;
}
