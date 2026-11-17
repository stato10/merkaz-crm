export const contactStatuses = ["lead", "prospect", "customer", "churned"] as const;
export type ContactStatus = (typeof contactStatuses)[number];

export const contactStatusLabel: Record<ContactStatus, string> = {
  lead: "ליד",
  prospect: "בתהליך",
  customer: "לקוח",
  churned: "עזב",
};

export const contactStatusTone = {
  lead: "info",
  prospect: "warn",
  customer: "ok",
  churned: "neutral",
} as const;

export const activityLabel: Record<string, string> = {
  note: "הערה",
  created: "נוצר",
  updated: "עודכן",
  call: "שיחה",
  email: "אימייל",
  meeting: "פגישה",
};

const dateFmt = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const rtf = new Intl.RelativeTimeFormat("he", { numeric: "auto" });

export const formatDate = (d: Date) => dateFmt.format(d);
export const formatDateTime = (d: Date) => dateTimeFmt.format(d);

export function timeAgo(d: Date, now = Date.now()) {
  const s = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return "הרגע";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), "day");
  return formatDate(d);
}

export const fullName = (c: { firstName: string; lastName: string }) =>
  `${c.firstName} ${c.lastName}`.trim();
