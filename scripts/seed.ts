/**
 * Demo data for a fresh database: one organization with a team, companies,
 * contacts, a sales pipeline, service tickets and appointments. All fictional.
 *
 *   npm run db:seed            (idempotent: skips if the demo org exists)
 *   npm run db:seed -- --reset (deletes and recreates the demo org)
 *
 * Demo login (also shown on the login page when DEMO_MODE=1):
 *   email:    demo@merkaz.dev
 *   password: DEMO_PASSWORD env var, or "merkaz-demo-2026"
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const DEMO_EMAIL = "demo@merkaz.dev";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "merkaz-demo-2026";
const ORG_SLUG = "demo-merkaz";

const day = 86_400_000;
const ago = (d: number, h = 10) => new Date(Date.now() - d * day + (h - 10) * 3_600_000);
const ahead = (d: number, h = 10) => {
  const t = new Date(Date.now() + d * day);
  t.setHours(h, 0, 0, 0);
  return t;
};
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const { hashPassword } = await import("better-auth/crypto");
  const { eq } = await import("drizzle-orm");
  const { db, schema } = await import("../src/db");
  const s = schema;

  const existing = await db.query.organization.findFirst({ where: eq(s.organization.slug, ORG_SLUG) });
  if (existing && !process.argv.includes("--reset")) {
    console.log("Demo organization already exists. Use --reset to recreate it.");
    process.exit(0);
  }
  if (existing) await db.delete(s.organization).where(eq(s.organization.id, existing.id));
  await db.delete(s.user).where(eq(s.user.email, DEMO_EMAIL));

  const orgId = "org_demo_merkaz";
  const people = [
    { id: "usr_demo_owner", name: "דנה כהן", email: DEMO_EMAIL, role: "owner" },
    { id: "usr_demo_sales", name: "יואב מזרחי", email: "yoav@merkaz.dev", role: "sales" },
    { id: "usr_demo_agent", name: "מאיה פרץ", email: "maya@merkaz.dev", role: "agent" },
  ];
  for (const p of people.slice(1)) await db.delete(s.user).where(eq(s.user.email, p.email));

  const hash = await hashPassword(DEMO_PASSWORD);
  await db.insert(s.organization).values({ id: orgId, name: "מרכז הדגמה בע״מ", slug: ORG_SLUG });
  for (const p of people) {
    await db.insert(s.user).values({ id: p.id, name: p.name, email: p.email, emailVerified: true });
    await db.insert(s.account).values({ id: `acc_${p.id}`, accountId: p.id, providerId: "credential", userId: p.id, password: hash });
    await db.insert(s.member).values({ id: `mem_${p.id}`, organizationId: orgId, userId: p.id, role: p.role });
  }
  const [owner, sales, agent] = people.map((p) => p.id);

  const companies = await db
    .insert(s.companies)
    .values([
      { orgId, name: "טכנומד מערכות רפואיות", domain: "technomed.co.il", industry: "בריאות", phone: "03-7654321", address: "הברזל 12, תל אביב", ownerId: sales },
      { orgId, name: "גלבוע לוגיסטיקה", domain: "gilboa-log.co.il", industry: "לוגיסטיקה", phone: "04-8123456", address: "דרך העצמאות 40, חיפה", ownerId: sales },
      { orgId, name: "סטודיו נגב אדריכלים", domain: "negev-arch.co.il", industry: "אדריכלות", phone: "08-6230011", ownerId: owner },
      { orgId, name: "אופק ביטוח ופיננסים", domain: "ofek-fin.co.il", industry: "פיננסים", phone: "03-5110022", address: "מנחם בגין 132, תל אביב", ownerId: sales },
      { orgId, name: "רשת קפה שקד", domain: "shaked-cafe.co.il", industry: "מסעדנות", phone: "09-7745500", ownerId: owner },
      { orgId, name: "אלקטרה הנדסה", domain: "electra-eng.co.il", industry: "הנדסה", phone: "02-6501234", address: "כנפי נשרים 8, ירושלים", ownerId: sales },
    ])
    .returning({ id: s.companies.id, name: s.companies.name });
  const co = (i: number) => companies[i].id;

  const contactRows: Omit<typeof s.contacts.$inferInsert, "orgId">[] = [
    { firstName: "יוסי", lastName: "ברק", email: "yossi@technomed.co.il", phone: "052-7788990", title: "מנכ״ל", status: "customer", companyId: co(0), tags: ["VIP"], source: "הפניה" },
    { firstName: "שירה", lastName: "פרידמן", email: "shira@technomed.co.il", phone: "052-6655443", title: "מנהלת רכש", status: "customer", companyId: co(0), tags: ["החלטה"] },
    { firstName: "אבי", lastName: "גולן", email: "avi@gilboa-log.co.il", phone: "054-3322110", title: "סמנכ״ל תפעול", status: "prospect", companyId: co(1), source: "כנס" },
    { firstName: "רונית", lastName: "שמעוני", email: "ronit@gilboa-log.co.il", phone: "050-9988776", title: "מנהלת IT", status: "prospect", companyId: co(1) },
    { firstName: "עומר", lastName: "חדד", email: "omer@negev-arch.co.il", phone: "053-4455667", title: "שותף מנהל", status: "lead", companyId: co(2), source: "אתר" },
    { firstName: "נטע", lastName: "אלון", email: "neta@ofek-fin.co.il", phone: "052-1122334", title: "מנהלת שירות", status: "customer", companyId: co(3), tags: ["חידוש"] },
    { firstName: "גיל", lastName: "רוזן", email: "gil@ofek-fin.co.il", phone: "054-2233445", title: "CFO", status: "prospect", companyId: co(3) },
    { firstName: "מיכל", lastName: "דהן", email: "michal@shaked-cafe.co.il", phone: "050-5566778", title: "בעלים", status: "lead", companyId: co(4), source: "פייסבוק" },
    { firstName: "אלון", lastName: "קורן", email: "alon@electra-eng.co.il", phone: "058-6677889", title: "מנהל פרויקטים", status: "prospect", companyId: co(5), source: "לינקדאין" },
    { firstName: "הדס", lastName: "ביטון", email: "hadas@electra-eng.co.il", phone: "052-7766554", title: "רכש", status: "lead", companyId: co(5) },
    { firstName: "תומר", lastName: "אשכנזי", email: "tomer.a@gmail.example", phone: "054-8899001", status: "lead", source: "אתר" },
    { firstName: "ליאת", lastName: "סעדה", email: "liat.s@example.com", phone: "050-1212121", status: "churned", source: "הפניה", tags: ["עזב למתחרה"] },
    { firstName: "דוד", lastName: "לוי", phone: "052-3434343", status: "lead", source: "טלפון" },
    { firstName: "קרן", lastName: "מור", email: "keren@negev-arch.co.il", phone: "053-5656565", title: "מנהלת משרד", status: "lead", companyId: co(2) },
  ];
  const contacts = await db
    .insert(s.contacts)
    .values(contactRows.map((c, i) => ({ ...c, orgId, ownerId: i % 3 === 2 ? owner : sales, createdAt: ago(40 - i * 2) })))
    .returning({ id: s.contacts.id, companyId: s.contacts.companyId, firstName: s.contacts.firstName, lastName: s.contacts.lastName });
  const ct = (i: number) => contacts[i];

  await db.insert(s.activities).values(
    contacts.map((c, i) => ({
      orgId,
      actorId: owner,
      contactId: c.id,
      companyId: c.companyId,
      type: "created",
      body: `${c.firstName} ${c.lastName} נוסף/ה למערכת`,
      createdAt: ago(40 - i * 2),
    })),
  );
  await db.insert(s.activities).values([
    { orgId, actorId: sales, contactId: ct(2).id, companyId: co(1), type: "call", body: "שיחת היכרות: 40 נהגים, מחפשים מעקב פניות ותורים במקום אקסל.", createdAt: ago(9) },
    { orgId, actorId: sales, contactId: ct(2).id, companyId: co(1), type: "email", body: "נשלחה הצעת מחיר לחבילת 25 משתמשים.", createdAt: ago(6) },
    { orgId, actorId: sales, contactId: ct(6).id, companyId: co(3), type: "meeting", body: "פגישה במשרדי אופק: ביקשו אינטגרציה עם מערכת הליבה דרך ה-API.", createdAt: ago(4) },
    { orgId, actorId: owner, contactId: ct(0).id, companyId: co(0), type: "note", body: "מרוצים מאוד. פתוחים להרחבה לסניף בחיפה ברבעון הבא.", createdAt: ago(3) },
    { orgId, actorId: sales, contactId: ct(8).id, companyId: co(5), type: "call", body: "מעוניינים בהדגמה של סוכן ה-AI לשירות לקוחות.", createdAt: ago(1) },
  ]);

  const stages = await db
    .insert(s.pipelineStages)
    .values([
      { orgId, name: "ליד חדש", position: 1, probability: 10 },
      { orgId, name: "שיחת היכרות", position: 2, probability: 25 },
      { orgId, name: "הצעת מחיר", position: 3, probability: 50 },
      { orgId, name: "משא ומתן", position: 4, probability: 75 },
    ])
    .returning({ id: s.pipelineStages.id });
  const st = (i: number) => stages[i].id;

  const dealRows: (Omit<typeof s.deals.$inferInsert, "orgId"> & { c: number })[] = [
    { title: "מערכת לניהול צי — 25 משתמשים", amount: 86_000, stageId: st(3), c: 2, expectedClose: isoDate(ahead(6)) },
    { title: "אינטגרציה עם מערכת הליבה", amount: 140_000, stageId: st(2), c: 6, expectedClose: isoDate(ahead(21)) },
    { title: "הרחבה לסניף חיפה", amount: 48_000, stageId: st(1), c: 0, expectedClose: isoDate(ahead(35)) },
    { title: "סוכן AI לשירות לקוחות", amount: 64_000, stageId: st(1), c: 8, expectedClose: isoDate(ahead(28)) },
    { title: "חבילת שירות שנתית", amount: 22_000, stageId: st(0), c: 4, expectedClose: isoDate(ahead(45)) },
    { title: "קופות וזימון תורים לרשת", amount: 36_000, stageId: st(0), c: 7 },
    { title: "חידוש רישיונות 2027", amount: 54_000, stageId: st(3), c: 5, expectedClose: isoDate(ago(2)) },
    { title: "הדרכת צוות מכירות", amount: 9_500, stageId: st(2), c: 9, expectedClose: isoDate(ahead(12)) },
    { title: "פרויקט הטמעה — טכנומד", amount: 120_000, stageId: st(3), c: 1, status: "won", closedAt: ago(5) },
    { title: "מנוי פרימיום", amount: 18_000, stageId: st(2), c: 5, status: "won", closedAt: ago(12) },
    { title: "מערכת CRM לסניפים", amount: 75_000, stageId: st(2), c: 11, status: "lost", closedAt: ago(8), lostReason: "בחרו בספק אחר בגלל מחיר" },
  ];
  const deals = await db
    .insert(s.deals)
    .values(
      dealRows.map(({ c, ...d }, i) => ({
        ...d,
        orgId,
        contactId: ct(c).id,
        companyId: ct(c).companyId,
        ownerId: i % 4 === 3 ? owner : sales,
        createdAt: ago(30 - i * 2),
        stageChangedAt: ago(10 - (i % 8)),
      })),
    )
    .returning();
  await db.insert(s.activities).values(
    deals.flatMap((d) => [
      { orgId, actorId: d.ownerId, dealId: d.id, contactId: d.contactId, companyId: d.companyId, type: "deal", body: `נפתחה עסקה: ${d.title}`, createdAt: d.createdAt },
      ...(d.status !== "open"
        ? [{ orgId, actorId: d.ownerId, dealId: d.id, contactId: d.contactId, companyId: d.companyId, type: "deal", body: d.status === "won" ? "העסקה נחתמה" : `העסקה לא נסגרה. סיבה: ${d.lostReason}`, createdAt: d.closedAt! }]
        : []),
    ]),
  );

  const ticketRows = [
    { subject: "לא מצליחים להתחבר מהנייד", priority: "high", status: "open", channel: "email", c: 1, body: "מאז העדכון אתמול שלושה עובדים לא מצליחים להתחבר מהטלפון. מקבלים הודעת שגיאה.", h: 3 },
    { subject: "בקשה להוספת שדה מספר עוסק", priority: "normal", status: "pending", channel: "web", c: 5, body: "אפשר להוסיף שדה של מספר עוסק בכרטיס חברה?", h: 26 },
    { subject: "חיוב כפול בחשבונית נובמבר", priority: "urgent", status: "open", channel: "phone", c: 0, body: "קיבלנו חיוב כפול על נובמבר. צריך זיכוי דחוף לפני סגירת חודש.", h: 1 },
    { subject: "איך מייבאים אנשי קשר מאקסל?", priority: "low", status: "resolved", channel: "whatsapp", c: 7, body: "יש לנו רשימה של 300 לקוחות באקסל, איך מכניסים?", h: 80 },
    { subject: "תזכורות SMS לא נשלחות", priority: "high", status: "open", channel: "web", c: 9, body: "לקוחות לא מקבלים תזכורת יום לפני התור.", h: 6 },
    { subject: "הדרכה לעובדים חדשים", priority: "normal", status: "pending", channel: "email", c: 3, body: "נצטרפו אלינו 4 עובדים, נשמח להדרכה קצרה בזום.", h: 50 },
  ] as const;
  for (const [i, t] of ticketRows.entries()) {
    const created = new Date(Date.now() - t.h * 3_600_000);
    const [row] = await db
      .insert(s.tickets)
      .values({
        orgId,
        number: 1001 + i,
        subject: t.subject,
        priority: t.priority,
        status: t.status,
        channel: t.channel,
        contactId: ct(t.c).id,
        assigneeId: i % 2 ? agent : owner,
        createdById: agent,
        createdAt: created,
        lastMessageAt: created,
        resolvedAt: t.status === "resolved" ? new Date(created.getTime() + 3_600_000) : null,
      })
      .returning({ id: s.tickets.id });
    await db.insert(s.ticketMessages).values({ orgId, ticketId: row.id, kind: "inbound", body: t.body, createdAt: created });
    if (t.status !== "open") {
      await db.insert(s.ticketMessages).values({
        orgId,
        ticketId: row.id,
        kind: "outbound",
        authorId: agent,
        body: t.status === "resolved" ? "בתפריט אנשי קשר יש כפתור ״ייבוא״ — מעלים את הקובץ והעמודות מזוהות אוטומטית." : "קיבלנו, אנחנו בודקים ונחזור אליך עד מחר.",
        createdAt: new Date(created.getTime() + 40 * 60_000),
      });
    }
  }

  const appts = [
    { title: "הדגמת מערכת", d: 1, h: 10, c: 4, status: "confirmed", location: "זום" },
    { title: "פגישת סגירה", d: 2, h: 14, c: 2, status: "scheduled", location: "משרדי גלבוע, חיפה" },
    { title: "הדרכת הטמעה", d: 3, h: 9, c: 0, status: "confirmed", location: "טכנומד, תל אביב" },
    { title: "שיחת חידוש", d: 6, h: 11, c: 5, status: "scheduled", location: "טלפון" },
    { title: "פגישת היכרות", d: -3, h: 12, c: 8, status: "completed", location: "משרדי אלקטרה" },
  ] as const;
  await db.insert(s.appointments).values(
    appts.map((a, i) => {
      const start = ahead(a.d, a.h);
      return {
        orgId,
        contactId: ct(a.c).id,
        title: a.title,
        startsAt: start,
        endsAt: new Date(start.getTime() + 45 * 60_000),
        status: a.status,
        assigneeId: i % 2 ? sales : owner,
        location: a.location,
      };
    }),
  );

  console.log(`Demo organization ready: ${contacts.length} contacts, ${deals.length} deals, ${ticketRows.length} tickets.`);
  console.log(`Sign in as ${DEMO_EMAIL} (password from DEMO_PASSWORD or the default in scripts/seed.ts).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
