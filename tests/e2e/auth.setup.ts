import { randomBytes } from "node:crypto";
import { test as setup } from "@playwright/test";

export const STATE = "tests/e2e/.auth/owner.json";

/** Sign up once through the real UI and reuse the session in every test. */
setup("sign up an owner with a fresh organization", async ({ page }) => {
  const id = randomBytes(4).toString("hex");
  await page.goto("/signup");
  await page.getByLabel("שם מלא").fill("בודק אוטומטי");
  await page.getByLabel("אימייל").fill(`e2e-${id}@example.test`);
  await page.getByLabel("סיסמה").fill(`Pw-${randomBytes(9).toString("base64url")}`);
  await page.getByRole("button", { name: "פתיחת חשבון" }).click();
  await page.waitForURL("**/onboarding");
  await page.getByLabel("שם הארגון").fill(`ארגון בדיקה ${id}`);
  await page.getByRole("button", { name: "המשך" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.context().storageState({ path: STATE });
});
