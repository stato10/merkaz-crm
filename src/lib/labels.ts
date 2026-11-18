export const contactStatuses = ["lead", "prospect", "customer", "churned"] as const;
export type ContactStatus = (typeof contactStatuses)[number];

export const contactStatusLabel: Record<ContactStatus, string> = {
  lead: "ליד",
  prospect: "בתהליך",
  customer: "לקוח",
  churned: "עזב",
};

export const contactStatusTone = {
  lead: "accent",
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
  ticket: "פנייה",
  appointment: "תור",
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

/* ---------------- Service ---------------- */

export const ticketStatuses = ["open", "pending", "resolved"] as const;
export type TicketStatus = (typeof ticketStatuses)[number];
export const ticketStatusLabel: Record<TicketStatus, string> = {
  open: "פתוחה",
  pending: "ממתינה ללקוח",
  resolved: "טופלה",
};
export const ticketStatusTone = { open: "info", pending: "warn", resolved: "ok" } as const;

export const ticketPriorities = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof ticketPriorities)[number];
export const ticketPriorityLabel: Record<TicketPriority, string> = {
  low: "נמוכה",
  normal: "רגילה",
  high: "גבוהה",
  urgent: "דחופה",
};
export const ticketPriorityTone = {
  low: "neutral",
  normal: "neutral",
  high: "warn",
  urgent: "danger",
} as const;

export const channelLabel: Record<string, string> = {
  manual: "ידני",
  phone: "טלפון",
  email: "אימייל",
  whatsapp: "וואטסאפ",
  web: "אתר",
  ai: "סוכן AI",
};

export const appointmentStatuses = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];
export const appointmentStatusLabel: Record<AppointmentStatus, string> = {
  scheduled: "נקבע",
  confirmed: "אושר",
  completed: "התקיים",
  cancelled: "בוטל",
  no_show: "לא הגיע",
};
export const appointmentStatusTone = {
  scheduled: "info",
  confirmed: "accent",
  completed: "ok",
  cancelled: "neutral",
  no_show: "danger",
} as const;

/* ---------------- Time zone ---------------- */

/** Business time zone. Appointment times are entered and shown in it. */
export const TZ = "Asia/Jerusalem";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zoned(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/** Offset of the business zone from UTC at instant `d`, in ms. */
function offsetMs(d: Date) {
  const z = zoned(d);
  const asUtc = Date.UTC(+z.y, +z.mo - 1, +z.d, +z.h, +z.mi, +z.s);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** "YYYY-MM-DDTHH:mm" in the business zone → Date. Null if malformed. */
export function fromLocalInput(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const first = new Date(guess - offsetMs(new Date(guess)));
  return new Date(guess - offsetMs(first));
}

/** Date → "YYYY-MM-DDTHH:mm" in the business zone, for datetime-local inputs. */
export function toLocalInput(d: Date) {
  const z = zoned(d);
  return `${z.y}-${z.mo}-${z.d}T${z.h}:${z.mi}`;
}

/** Calendar day key (YYYY-MM-DD) in the business zone. */
export const dayKey = (d: Date) => toLocalInput(d).slice(0, 10);

/** Start of the business-zone day containing `d`. */
export const startOfDay = (d: Date) => fromLocalInput(`${dayKey(d)}T00:00`)!;

const timeFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});
export const formatTime = (d: Date) => timeFmt.format(d);

export function formatDay(d: Date, now = new Date()) {
  const k = dayKey(d);
  if (k === dayKey(now)) return "היום";
  if (k === dayKey(new Date(now.getTime() + 86400000))) return "מחר";
  if (k === dayKey(new Date(now.getTime() - 86400000))) return "אתמול";
  return dayFmt.format(d);
}
