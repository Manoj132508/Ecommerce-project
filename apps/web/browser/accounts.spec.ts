import { expect, expectCleanPage, isCompact, newCustomer, signInThroughApi, signOutFromHeader, test } from "./support";

test.describe("accounts", () => {
  test("register with validation, sign in, return to the search, sign out", async ({ page, problems }) => {
    const customer = newCustomer("Reg");
    await page.goto("/products?q=sun");
    await page.getByRole("link", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/register\?from=%2Fproducts%3Fq%3Dsun$/);

    // Labels work; each validation message is tied to its field (accessible
    // description) and focus moves to the first problem before anything is sent.
    await page.getByLabel("Name").fill(customer.name);
    await page.getByLabel("Email").fill(customer.email);
    const password = page.getByLabel("Password", { exact: true });
    const confirm = page.getByLabel("Confirm password");
    await password.fill("short");
    await confirm.fill("different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(password).toBeFocused();
    await expect(password).toHaveAccessibleDescription("At least 8 characters. Use at least 8 characters.");
    await expect(confirm).toHaveAccessibleDescription("Passwords do not match.");
    await expect(confirm).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Password", { exact: true }).fill(customer.password);
    await page.getByLabel("Confirm password").fill(customer.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/login\?from=%2Fproducts%3Fq%3Dsun$/);
    await expect(page.getByRole("status").filter({ hasText: "account has been created" })).toBeVisible();

    await page.getByLabel("Email").fill(customer.email);
    await page.getByLabel("Password").fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Invalid email or password");
    await page.getByLabel("Password").fill(customer.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/products\?q=sun$/);
    await expect(page.getByRole("searchbox", { name: "Search products" })).toHaveValue("sun");
    await expect(page.getByRole("button", { name: isCompact(page) ? /^Menu/ : "Sign out" })).toBeVisible();

    await signOutFromHeader(page);
    const guarded = await page.goto("/account");
    expect(guarded?.url()).toMatch(/\/login\?from=%2Faccount$/);
    expectCleanPage(problems, { allow: [/401 \(Unauthorized\)/] });
  });

  test("a return path to another site is ignored after sign-in", async ({ page }) => {
    const customer = newCustomer("Safe");
    await signInThroughApi(page.request, customer);
    await page.context().clearCookies();
    await page.goto(`/login?from=${encodeURIComponent("https://evil.example/steal")}`);
    await page.getByLabel("Email").fill(customer.email);
    await page.getByLabel("Password").fill(customer.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("keyboard: skip-free tab order reaches search and sign-in with a visible focus ring", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "WebKit does not Tab to links by default (macOS/Safari preference); covered in Chromium and Firefox");
    await page.goto("/");
    // The session area renders after hydration; tab once it is there.
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    const reached: string[] = [];
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          label: element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? element.textContent?.trim() ?? "",
          ring: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
        };
      });
      expect(focused?.ring, `focus ring on ${focused?.label}`).toBe(true);
      reached.push(focused?.label ?? "");
    }
    // First the store name (from NEXT_PUBLIC_APP_NAME), then:
    expect(reached.slice(1)).toEqual(["Search products", "Search", "Sign in"]);
  });
});
