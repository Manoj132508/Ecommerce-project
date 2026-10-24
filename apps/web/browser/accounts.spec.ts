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
    // The guard check runs in a new page of the same browser context (same cookies). The signed-out
    // page is still applying its own router.refresh(); navigating it at that moment raced the refresh
    // in WebKit and Firefox on CI ("interrupted by another navigation", NS_BINDING_ABORTED, an aborted
    // fetch). Nothing about the app's behaviour is relaxed: /account must still send a signed-out
    // visitor to sign in.
    const fresh = await page.context().newPage();
    const guarded = await fresh.goto("/account");
    expect(guarded?.url()).toMatch(/\/login\?from=%2Faccount$/);
    await fresh.close();
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

  test("keyboard: skip link first, then search and sign-in, each with a visible focus ring", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "WebKit does not Tab to links by default (macOS/Safari preference); covered in Chromium and Firefox");
    await page.goto("/");
    // The session area renders after hydration; tab once it is there.
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    const reached: string[] = [];
    for (let step = 0; step < 5; step += 1) {
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
    // The skip link, the store name (from NEXT_PUBLIC_APP_NAME), then:
    expect(reached[0]).toBe("Skip to content");
    expect(reached.slice(2)).toEqual(["Search products", "Search", "Sign in"]);

    // The skip link moves keyboard focus past the header to the page content.
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("password toggle: pressed state, the value is shown only while pressed, and hidden again on submit", async ({ page, problems }) => {
    await page.goto("/login");
    const password = page.getByLabel("Password", { exact: true });
    const toggle = page.getByRole("button", { name: "Show password" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.getByLabel("Email").fill("nobody@example.com");
    await password.fill("not-the-password-1");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Invalid email or password");
    expectCleanPage(problems, { allow: [/401 \(Unauthorized\)/] });
  });

  test("sign out on all devices: a modal confirmation, Escape keeps the session, confirming ends it", async ({ page, problems }) => {
    await signInThroughApi(page.request, newCustomer("Everywhere"));
    await page.goto("/account");
    const opener = page.getByRole("button", { name: "Sign out on all devices" });
    await opener.click();
    const dialog = page.getByRole("alertdialog", { name: "Sign out on all devices?" });
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(page.getByRole("button", { name: "Stay signed in" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect((await page.request.get("/api/auth/session")).status()).toBe(200);

    await opener.click();
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await page.request.get("/api/auth/session")).status()).toBe(401);
    expectCleanPage(problems, { allow: [/401 \(Unauthorized\)/] });
  });
});
