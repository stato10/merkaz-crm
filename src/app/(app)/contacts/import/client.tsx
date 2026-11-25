"use client";

import { FileUp } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Badge, Button, buttonClass, Card, cx, Select } from "@/components/ui";
import { type ContactField, detectColumns, parseCsv } from "@/lib/csv";
import { importContacts } from "./actions";

const fieldLabel: Record<ContactField, string> = {
  firstName: "שם פרטי",
  lastName: "שם משפחה",
  fullName: "שם מלא",
  email: "אימייל",
  phone: "טלפון",
  title: "תפקיד",
  company: "חברה",
  status: "סטטוס",
  source: "מקור",
  tags: "תגיות",
};

type Parsed = { name: string; headers: string[]; rows: string[][] };

export function ImportFlow() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<(ContactField | null)[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, action, pending] = useActionState(importContacts, undefined);

  async function load(file: File | undefined) {
    setReadError(null);
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) return setReadError("צריך קובץ CSV. באקסל: קובץ ← שמירה בשם ← CSV UTF-8.");
    const all = parseCsv(await file.text());
    if (all.length < 2) return setReadError("לא נמצאו שורות נתונים בקובץ");
    setParsed({ name: file.name, headers: all[0], rows: all.slice(1) });
    setMapping(detectColumns(all[0]));
    // Keep the chosen file in the form input (drag & drop sets it here).
    if (fileRef.current && fileRef.current.files?.[0] !== file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileRef.current.files = dt.files;
    }
  }

  // A file picked before hydration finished never fired our onChange; pick it up now.
  useEffect(() => {
    const early = fileRef.current?.files?.[0];
    if (early) void load(early);
  }, []);

  const hasName = mapping.includes("firstName") || mapping.includes("fullName");

  if (report?.imported !== undefined) {
    return (
      <Card className="max-w-2xl p-6">
        <h2 className="text-lg font-semibold">הייבוא הסתיים</h2>
        <div className="mt-4 grid grid-cols-3 divide-x divide-x-reverse divide-line rounded border border-line text-center">
          <Stat label="נוספו" value={report.imported} tone="text-ok" />
          <Stat label="כפולים שדולגו" value={report.duplicates ?? 0} />
          <Stat label="שורות עם שגיאה" value={report.failedCount ?? 0} tone={report.failedCount ? "text-danger" : undefined} />
        </div>
        {!!report.companiesCreated && <p className="mt-3 text-sm text-muted">נוצרו גם {report.companiesCreated} חברות חדשות.</p>}
        {!!report.failed?.length && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-medium">שורות שלא נוספו</h3>
            <ul className="max-h-48 overflow-auto rounded bg-surface-2 p-3 text-sm">
              {report.failed.map((f) => (
                <li key={f.row}>שורה {f.row}: {f.message}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-6 flex gap-2">
          <Link href="/contacts" className={buttonClass()}>לאנשי הקשר</Link>
          <button type="button" className={buttonClass("ghost")} onClick={() => location.reload()}>ייבוא קובץ נוסף</button>
        </div>
      </Card>
    );
  }

  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          load(e.dataTransfer.files[0]);
        }}
        className={cx(
          "grid cursor-pointer place-items-center gap-2 rounded-md border-2 border-dashed bg-surface px-6 py-10 text-center transition-colors",
          drag ? "border-accent bg-accent-soft" : "border-line hover:border-accent/60",
        )}
      >
        <FileUp size={28} strokeWidth={1.5} className="text-accent" />
        <span className="font-medium">{parsed ? parsed.name : "גררו לכאן קובץ CSV, או לחצו לבחירה"}</span>
        <span className="text-sm text-muted">
          {parsed ? `${parsed.rows.length.toLocaleString("he-IL")} שורות` : "עד 5,000 שורות. אנשי קשר שכבר קיימים (לפי אימייל או טלפון) ידולגו."}
        </span>
        <input ref={fileRef} type="file" name="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => load(e.currentTarget.files?.[0])} />
      </label>
      {readError && <p role="alert" className="text-sm text-danger">{readError}</p>}

      {parsed && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-3">
            <h2 className="font-semibold">התאמת עמודות</h2>
            <p className="text-sm text-muted">זיהינו את העמודות לפי הכותרות. אפשר לשנות.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-line">
                  {parsed.headers.map((h, i) => (
                    <th key={i} className="min-w-40 px-3 py-2.5 text-start align-top font-normal">
                      <span className="mb-1.5 block truncate text-xs text-muted">{h || `עמודה ${i + 1}`}</span>
                      <Select
                        aria-label={`שדה עבור ${h}`}
                        value={mapping[i] ?? ""}
                        onChange={(e) => {
                          const v = (e.currentTarget.value || null) as ContactField | null;
                          setMapping((m) => m.map((x, j) => (j === i ? v : x === v && v ? null : x)));
                        }}
                        className={cx("h-9", !mapping[i] && "text-muted")}
                      >
                        <option value="">לא לייבא</option>
                        {(Object.keys(fieldLabel) as ContactField[]).map((f) => (
                          <option key={f} value={f}>{fieldLabel[f]}</option>
                        ))}
                      </Select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {parsed.rows.slice(0, 5).map((r, ri) => (
                  <tr key={ri}>
                    {parsed.headers.map((_, i) => (
                      <td key={i} dir="auto" className={cx("max-w-48 truncate px-3 py-2.5 text-start", !mapping[i] && "text-muted/60")}>{r[i]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
            {hasName ? (
              <Badge tone="ok">מוכן לייבוא</Badge>
            ) : (
              <Badge tone="warn">סמנו איזו עמודה מכילה את השם</Badge>
            )}
            {parsed.rows.length > 5 && <span className="text-sm text-muted">מוצגות 5 שורות ראשונות</span>}
            <Button className="ms-auto" disabled={!hasName || pending}>
              {pending ? "מייבא…" : `ייבוא ${parsed.rows.length.toLocaleString("he-IL")} שורות`}
            </Button>
          </div>
          {report?.error && <p role="alert" className="px-5 pb-4 text-sm text-danger">{report.error}</p>}
        </Card>
      )}
    </form>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="px-3 py-4">
      <p className={cx("text-2xl font-medium tabular-nums", tone ?? "text-ink")}>{value.toLocaleString("he-IL")}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
}
