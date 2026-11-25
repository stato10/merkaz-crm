import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const uid = () => randomBytes(3).toString("hex");

test("sales journey: add a contact, open a deal, win it, contact becomes a customer @mobile", async ({ page }) => {
  const id = uid();
  await page.goto("/contacts/new");
  await page.getByLabel("שם פרטי").fill("נועה");
  await page.getByLabel("שם משפחה").fill(`לוי ${id}`);
  await page.getByLabel("אימייל").fill(`noa-${id}@example.test`);
  await page.getByRole("button", { name: "יצירה" }).click();
  await expect(page.getByRole("heading", { name: `נועה לוי ${id}` })).toBeVisible();

  await page.goto("/deals/new");
  await page.getByLabel("שם העסקה").fill(`חבילה שנתית ${id}`);
  await page.getByLabel("סכום (₪)").fill("48000");
  await page.getByLabel("איש קשר").selectOption({ label: `נועה לוי ${id}` });
  await page.getByRole("button", { name: "פתיחת עסקה" }).click();
  await expect(page.getByRole("heading", { name: `חבילה שנתית ${id}` })).toBeVisible();

  await page.getByRole("button", { name: "נחתמה" }).click();
  await expect(page.getByText("העסקה נחתמה").first()).toBeVisible();

  await page.goto("/contacts?status=customer");
  await expect(page.getByRole("link", { name: new RegExp(`נועה לוי ${id}`) })).toBeVisible();
});

test("deals board shows a new deal in its stage", async ({ page }) => {
  const title = `שדרוג רישיונות ${uid()}`;
  await page.goto("/deals/new");
  await page.getByLabel("שם העסקה").fill(title);
  await page.getByLabel("סכום (₪)").fill("12000");
  await page.getByRole("button", { name: "פתיחת עסקה" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.goto("/deals");
  const board = page.getByRole("list", { name: "שלבי המכירה" });
  await expect(board.getByText(title)).toBeVisible();
});

test("API keys: an admin creates a key and calls the API with it", async ({ page, request }) => {
  const name = `מה-API ${uid()}`;
  await page.goto("/settings/developers");
  await page.getByLabel("שם המפתח").fill("E2E");
  await page.getByRole("button", { name: "יצירת מפתח" }).click();
  const token = await page.getByRole("textbox", { name: "מפתח API" }).inputValue();
  expect(token).toMatch(/^crm_live_/);

  const res = await request.post("/api/v1/contacts", {
    headers: { authorization: `Bearer ${token}` },
    data: { first_name: name },
  });
  expect(res.status()).toBe(201);
  const unauthorized = await request.get("/api/v1/contacts", { headers: { authorization: "Bearer nope" } });
  expect(unauthorized.status()).toBe(401);

  await page.goto(`/contacts?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(name)).toBeVisible();
});

test("CSV import maps Hebrew columns and skips duplicates", async ({ page }) => {
  const id = uid();
  await page.goto("/contacts/import");
  const csv = [
    "שם מלא,אימייל,טלפון",
    `דנה כהן,dana-${id}@example.test,`,
    `אבי לוי,avi-${id}@example.test,`,
    `דנה כהן,dana-${id}@example.test,`,
  ].join("\n");
  await page.locator("input[type=file]").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("מוכן לייבוא")).toBeVisible();
  await page.getByRole("button", { name: /ייבוא 3 שורות/ }).click();
  await expect(page.getByRole("heading", { name: "הייבוא הסתיים" })).toBeVisible();
  await expect(page.getByText("נוספו", { exact: true }).locator("..")).toContainText("2");
  await expect(page.getByText("כפולים שדולגו").locator("..")).toContainText("1");
});
