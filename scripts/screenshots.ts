/**
 * Captures README screenshots from a running instance logged in as the demo user.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/screenshots.ts
 */
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "docs/screenshots";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  const res = await ctx.request.post(`${base}/api/auth/sign-in/email`, {
    headers: { origin: base },
    data: { email: "demo@merkaz.dev", password: process.env.DEMO_PASSWORD ?? "merkaz-demo-2026" },
  });
  if (!res.ok()) throw new Error(`demo sign-in failed: ${res.status()}`);
  const page = await ctx.newPage();

  const shot = async (path: string, name: string, prep?: () => Promise<void>) => {
    await page.goto(base + path);
    await page.waitForLoadState("networkidle");
    await prep?.();
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log("saved", name);
  };

  await shot("/", "overview");
  await shot("/deals", "pipeline");
  await shot("/tickets", "inbox");
  const firstDeal = await page.goto(base + "/deals?view=list").then(() => page.locator("table a").first().getAttribute("href"));
  if (firstDeal) await shot(firstDeal, "deal");
  const firstContact = await page.goto(base + "/contacts").then(() => page.locator("table a").first().getAttribute("href"));
  if (firstContact) await shot(firstContact, "contact");
  await shot("/settings/developers", "developers");

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "he-IL", storageState: await ctx.storageState() });
  const m = await mobile.newPage();
  await m.goto(base + "/deals");
  await m.waitForLoadState("networkidle");
  await m.screenshot({ path: `${out}/mobile-pipeline.png` });
  console.log("saved mobile-pipeline");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
