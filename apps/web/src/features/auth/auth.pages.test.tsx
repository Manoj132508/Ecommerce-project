// @vitest-environment jsdom
// Sign-in, registration, account, header session state and the add-to-cart
// control, against a fake same-origin API. Checks what is sent (CSRF header,
// no tokens) and what is kept (nothing in storage; no token in Redux or cache).
import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SiteHeader } from "@/components/SiteHeader";
import { AddToCartControls } from "@/features/cart/AddToCartControls";
import { sessionQueryKey } from "@/lib/queryKeys";
import { noticeShown } from "@/store/uiSlice";
import { navigation, RedirectSignal } from "@/test/navigation";
import { ALICE, browserStorageSnapshot, fakeApi, renderWithProviders, SESSION } from "@/test/render";
import { AccountActions } from "./AccountActions";
import { LoginForm } from "./LoginForm";
import { NOTICES } from "./notices";
import { RegisterForm } from "./RegisterForm";

const serverSession = vi.hoisted(() => ({ getServerSessionUser: vi.fn() }));
vi.mock("@/lib/server/session", () => serverSession);

const PRODUCT_ID = "e43638ce-6aa0-4b85-b27f-e1d07eb678c6";

describe("sign-in page", () => {
  test("signs in, keeps only the user and CSRF token in memory, and returns to a safe page", async () => {
    navigation.reset("/login", "from=%2Fproducts%3Fq%3Dsun");
    const { requests } = fakeApi({ "POST /api/auth/session": { status: 200, body: { ...SESSION, token: "must-not-be-kept" } } });
    const { user, queryClient, store } = renderWithProviders(<LoginForm />, { session: null });

    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "right-password-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/products?q=sun"));
    expect(requests).toEqual([expect.objectContaining({ method: "POST", path: "/api/auth/session", body: { email: "alice@example.com", password: "right-password-1" } })]);
    expect(requests[0]?.headers).not.toHaveProperty("x-csrf-token");
    expect(queryClient.getQueryData(sessionQueryKey)).toEqual(SESSION);
    const kept = browserStorageSnapshot(queryClient, store);
    expect(kept).not.toContain("must-not-be-kept");
    expect(kept).not.toContain("right-password-1");
    expect(window.localStorage).toHaveLength(0);
  });

  test.each(["//evil.example", "https://evil.example", "/login", "/\\evil"])("ignores the unsafe return path %j", async (from) => {
    navigation.reset("/login", `from=${encodeURIComponent(from)}`);
    fakeApi({ "POST /api/auth/session": { status: 200, body: SESSION } });
    const { user } = renderWithProviders(<LoginForm />, { session: null });
    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "password-1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
  });

  test("empty or malformed fields are explained on the fields themselves; nothing is sent", async () => {
    const { requests } = fakeApi({});
    const { user } = renderWithProviders(<LoginForm />, { session: null });
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter your email address.");
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Enter your password.");
    await user.type(screen.getByLabelText("Email"), "nora");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter an email address such as name@example.com.");
    expect(requests).toEqual([]);
  });

  test("rejected credentials mark both fields and are linked to them", async () => {
    fakeApi({ "POST /api/auth/session": { status: 401, body: { message: "Invalid email or password" } } });
    const { user } = renderWithProviders(<LoginForm />, { session: null });
    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Invalid email or password"));
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Invalid email or password");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  test("shows the server's message for wrong credentials and for rate limiting", async () => {
    const answers = [{ status: 401, body: { message: "Invalid email or password" } }, { status: 429, body: { message: "Too many attempts. Please wait a few minutes and try again." } }];
    fakeApi({ "POST /api/auth/session": () => answers.shift() ?? { status: 500 } });
    const { user } = renderWithProviders(<LoginForm />, { session: null });
    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test("shows a notice set elsewhere (for example after registering) and links to registration with the same return path", async () => {
    navigation.reset("/login", "from=%2Faccount");
    fakeApi({});
    const { store } = renderWithProviders(<LoginForm />, { session: null });
    act(() => { store.dispatch(noticeShown(NOTICES.accountCreated)); });
    expect(await screen.findByRole("status")).toHaveTextContent(NOTICES.accountCreated);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/register?from=%2Faccount");
  });
});

describe("registration page", () => {
  const fill = async (user: ReturnType<typeof renderWithProviders>["user"], password = "nora-password-1", confirm = password) => {
    await user.type(screen.getByLabelText("Name"), "Nora");
    await user.type(screen.getByLabelText("Email"), "nora@example.com");
    await user.type(screen.getByLabelText("Password"), password);
    await user.type(screen.getByLabelText("Confirm password"), confirm);
    await user.click(screen.getByRole("button", { name: "Create account" }));
  };

  test("creates the account, then goes to sign-in with a notice and the return path; nothing is stored", async () => {
    navigation.reset("/register", "from=%2Fproducts");
    const { requests } = fakeApi({ "POST /api/auth/accounts": { status: 201, body: { user: { ...ALICE, _id: "6ad8b3e08afe6f8ad3173cad", name: "Nora", email: "nora@example.com" } } } });
    const { user, queryClient, store } = renderWithProviders(<RegisterForm />, { session: null });
    await fill(user);

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/login?from=%2Fproducts"));
    expect(store.getState().ui.notice).toBe(NOTICES.accountCreated);
    expect(requests).toEqual([expect.objectContaining({ method: "POST", path: "/api/auth/accounts", body: { name: "Nora", email: "nora@example.com", password: "nora-password-1" } })]);
    // Not signed in by registering: the session stays signed out until the user signs in.
    expect(queryClient.getQueryData(sessionQueryKey)).toBeNull();
    expect(browserStorageSnapshot(queryClient, store)).not.toContain("nora-password-1");
  });

  test("client-side checks: each message is tied to its field and focused, before anything is sent", async () => {
    const { requests } = fakeApi({});
    const { user } = renderWithProviders(<RegisterForm />, { session: null });
    await fill(user, "password-1", "password-2");
    const confirm = screen.getByLabelText("Confirm password");
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAccessibleDescription("Passwords do not match.");
    expect(confirm).toHaveFocus();

    await user.clear(screen.getByLabelText("Password"));
    await user.clear(confirm);
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(confirm, "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAccessibleDescription("At least 8 characters. Use at least 8 characters.");
    expect(password).toHaveFocus();
    expect(confirm).not.toHaveAttribute("aria-invalid");

    await user.clear(screen.getByLabelText("Name"));
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Enter your name.");
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter an email address such as name@example.com.");
    expect(requests).toEqual([]);
  });

  test("an address that is already registered (409) is reported on the email field", async () => {
    fakeApi({ "POST /api/auth/accounts": { status: 409, body: { message: "User already exists" } } });
    const { user } = renderWithProviders(<RegisterForm />, { session: null });
    await fill(user);
    const email = screen.getByLabelText("Email");
    await waitFor(() => expect(email).toHaveAccessibleDescription("User already exists"));
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveFocus();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  test.each([
    [400, { message: "Provide a name, valid email, and password of at least 8 characters (maximum 72 bytes)" }, "Provide a name, valid email"],
    [429, { message: "Too many attempts. Please wait a few minutes and try again." }, "Too many attempts"],
    [500, { message: "Server error" }, "Server error"],
    [502, "<html>bad gateway</html>", "Something went wrong. Please try again."],
  ])("API %i is shown safely and does not navigate", async (status, body, shown) => {
    fakeApi({ "POST /api/auth/accounts": { status, body } });
    const { user } = renderWithProviders(<RegisterForm />, { session: null });
    await fill(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(shown);
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("header session state", () => {
  test("signed out: sign-in and register links that return to the current page; search is labelled", async () => {
    navigation.reset("/products/abc");
    fakeApi({ "GET /api/auth/session": { status: 401, body: { message: "Not authorized" } } });
    renderWithProviders(<SiteHeader />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?from=%2Fproducts%2Fabc");
    expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register?from=%2Fproducts%2Fabc");
    const search = screen.getByRole("searchbox", { name: "Search products" });
    expect(search).toHaveAttribute("name", "q");
    expect(search.closest("form")).toHaveAttribute("action", "/products");
  });

  test("the search box shows the current search, and sign-in returns to it", async () => {
    navigation.reset("/products", "q=sun&category=Accessories");
    fakeApi({ "GET /api/auth/session": { status: 401, body: { message: "Not authorized" } } });
    renderWithProviders(<SiteHeader />);
    expect(screen.getByRole("searchbox", { name: "Search products" })).toHaveValue("sun");
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?from=${encodeURIComponent("/products?q=sun&category=Accessories")}`);
  });

  test("on the home and sign-in pages the sign-in link carries no return path", async () => {
    fakeApi({ "GET /api/auth/session": { status: 401, body: { message: "Not authorized" } } });
    navigation.reset("/login", "from=%2Forders");
    const { unmount } = renderWithProviders(<SiteHeader />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    unmount();
    navigation.reset("/");
    renderWithProviders(<SiteHeader />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  test("the cart drawer takes focus, keeps Tab inside, and gives focus back when closed", async () => {
    fakeApi({
      "GET /api/cart-items?expand=product": { status: 200, body: [] },
      "GET /api/delivery-options?expand=estimatedDeliveryTime": { status: 200, body: [] },
      "GET /api/payment-summary": { status: 200, body: { totalItems: 0, productCostCents: 0, shippingCostCents: 0, totalCostBeforeTaxCents: 0, taxCents: 0, totalCostCents: 0, unavailableProductIds: [] } },
    });
    const { user } = renderWithProviders(<SiteHeader />, { session: SESSION });
    const opener = screen.getByRole("button", { name: /Open cart drawer/ });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Your cart" });
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    await screen.findByRole("link", { name: "Browse products" });
    await user.tab();
    expect(screen.getByRole("link", { name: "Browse products" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  test("Escape closes the mobile menu and returns focus to its button", async () => {
    fakeApi({ "GET /api/cart-items?expand=product": { status: 200, body: [] } });
    const { user } = renderWithProviders(<SiteHeader />, { session: SESSION });
    const menu = screen.getByRole("button", { name: /^Menu/ });
    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });

  test("hydrates without a mismatch even when the session arrived before the header hydrated (WebKit timing)", async () => {
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { Provider } = await import("react-redux");
    const { makeStore } = await import("@/store/store");
    fakeApi({ "GET /api/cart-items?expand=product": { status: 200, body: [] } });
    const tree = (client: InstanceType<typeof QueryClient>) => (
      <Provider store={makeStore()}><QueryClientProvider client={client}><SiteHeader /></QueryClientProvider></Provider>
    );
    // The server has no session yet.
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree(new QueryClient()));
    document.body.append(container);
    // In the browser the session query has already resolved when this boundary hydrates.
    const client = new QueryClient();
    client.setQueryData(sessionQueryKey, SESSION);
    const recoverable: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, tree(client), { onRecoverableError: (error) => recoverable.push(error) });
    });
    expect(recoverable).toEqual([]);
    expect(await screen.findByRole("link", { name: "Alice" })).toBeInTheDocument();
    container.remove();
  });

  test("signed in: account link and sign-out (CSRF-protected), which clears the user's data", async () => {
    const { requests } = fakeApi({ "DELETE /api/auth/session": { status: 204 } });
    const { user, queryClient } = renderWithProviders(<SiteHeader />, { session: SESSION });
    queryClient.setQueryData(["cart", ALICE._id], [{ productId: PRODUCT_ID, quantity: 1 }]);
    expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute("href", "/account");

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(requests.filter((request) => request.method === "DELETE")).toEqual([expect.objectContaining({ method: "DELETE", path: "/api/auth/session", headers: expect.objectContaining({ "x-csrf-token": SESSION.csrfToken }) })]);
    expect(queryClient.getQueryData(["cart", ALICE._id])).toBeUndefined();
    expect(navigation.refresh).toHaveBeenCalled();
  });

  test("an expired session is noticed when the session is checked again", async () => {
    fakeApi({ "GET /api/auth/session": { status: 401, body: { message: "Not authorized" } } });
    const { queryClient } = renderWithProviders(<SiteHeader />, { session: SESSION });
    expect(screen.getByRole("link", { name: "Alice" })).toBeInTheDocument();
    await act(() => queryClient.invalidateQueries({ queryKey: sessionQueryKey }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  test("keyboard: every header control is reachable with Tab", async () => {
    fakeApi({});
    const { user } = renderWithProviders(<SiteHeader />, { session: SESSION });
    const controls = [...document.querySelectorAll<HTMLElement>('a[href], input, button:not([disabled])')];
    const reached: HTMLElement[] = [];
    for (let step = 0; step < controls.length; step += 1) {
      await user.tab();
      reached.push(document.activeElement as HTMLElement);
    }
    expect(reached).toEqual(controls);
    expect(screen.getAllByRole("link", { name: "Cart (0)" })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Checkout" })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Orders" })).not.toHaveLength(0);
  });
});

describe("account", () => {
  test("the account area redirects to sign-in without a session, and shows the profile with one", async () => {
    const { default: AccountLayout } = await import("@/app/account/layout");
    const { default: AccountPage } = await import("@/app/account/page");
    serverSession.getServerSessionUser.mockResolvedValue(null);
    await expect(AccountLayout({ children: null })).rejects.toEqual(new RedirectSignal("/login?from=%2Faccount"));
    await expect(AccountPage()).rejects.toBeInstanceOf(RedirectSignal);

    serverSession.getServerSessionUser.mockResolvedValue(ALICE);
    fakeApi({});
    renderWithProviders(await AccountLayout({ children: await AccountPage() }), { session: SESSION });
    expect(screen.getByRole("heading", { name: "Your account" })).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Customer")).toBeInTheDocument();
  });

  test("sign out on all devices ends every session and leaves the account area", async () => {
    const { requests } = fakeApi({ "DELETE /api/auth/sessions": { status: 204 } });
    const { user, queryClient } = renderWithProviders(<AccountActions />, { session: SESSION });
    await user.click(screen.getByRole("button", { name: "Sign out on all devices" }));
    // A confirmation first: focus on "Stay signed in", nothing sent yet.
    expect(screen.getByRole("alertdialog", { name: "Sign out on all devices?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stay signed in" })).toHaveFocus();
    expect(requests).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
    expect(requests[0]).toMatchObject({ method: "DELETE", path: "/api/auth/sessions", headers: { "x-csrf-token": SESSION.csrfToken } });
    expect(queryClient.getQueryData(sessionQueryKey)).toBeNull();
  });
});

describe("add to cart", () => {
  const controls = <AddToCartControls productId={PRODUCT_ID} productName="Athletic Skateboard Shoes" returnTo="/products/e43638ce-6aa0-4b85-b27f-e1d07eb678c6" />;

  test("signed out: explains and goes to sign-in, returning to the product", async () => {
    const { requests } = fakeApi({});
    const { user, store } = renderWithProviders(controls, { session: null });
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(store.getState().ui.notice).toBe(NOTICES.cartLogin);
    expect(navigation.push).toHaveBeenCalledWith(`/login?from=${encodeURIComponent(`/products/${PRODUCT_ID}`)}`);
    expect(requests).toEqual([]);
  });

  test("signed in: sends the quantity with the CSRF token and confirms", async () => {
    const { requests } = fakeApi({ "POST /api/cart-items": { status: 201, body: { productId: PRODUCT_ID, quantity: 3 } } });
    const { user } = renderWithProviders(controls, { session: SESSION });
    await user.selectOptions(screen.getByLabelText("Quantity"), "3");
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(await screen.findByText("Added 3 to your cart")).toBeInTheDocument();
    expect(requests).toEqual([expect.objectContaining({ method: "POST", path: "/api/cart-items", body: { productId: PRODUCT_ID, quantity: 3 }, headers: expect.objectContaining({ "x-csrf-token": SESSION.csrfToken }) })]);
  });

  test("an expired session (401) signs out locally and asks to sign in again", async () => {
    fakeApi({ "POST /api/cart-items": { status: 401, body: { message: "Not authorized" } } });
    const { user, queryClient, store } = renderWithProviders(controls, { session: SESSION });
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    expect(store.getState().ui.notice).toBe(NOTICES.sessionExpired);
    expect(queryClient.getQueryData(sessionQueryKey)).toBeNull();
  });

  test("other errors are shown; quantities are 1-10; keyboard operable", async () => {
    fakeApi({ "POST /api/cart-items": { status: 404, body: { message: "Product not found" } } });
    const { user } = renderWithProviders(controls, { session: SESSION });
    const select = screen.getByLabelText("Quantity");
    expect([...select.querySelectorAll("option")].map((option) => option.value)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    await user.tab();
    expect(select).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Add to Cart" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Product not found");
  });
});
