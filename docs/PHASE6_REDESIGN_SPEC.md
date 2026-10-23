# Phase 6 — Storefront redesign specification

Status: **approved; Phase 6A (design system and shared UI) implemented 2026-10-22** — see §8; **Phase 6B (home,
catalogue with sorting, product details) implemented 2026-10-23** — see §9; **Phase 6C (cart drawer, cart, checkout,
orders, tracking) implemented 2026-10-23** — see §10. Account,
authentication and admin come next. It applies to the
Next.js storefront in `apps/web` only; the legacy Vite app is not redesigned. Behaviour, URLs, API
contracts, security properties and test coverage from Phases 5A–5F stay as they are: the redesign
changes presentation and component structure, not business rules.

## 0. Decisions already approved (MIGRATION_PLAN.md §6 Phase 6)

These come from the approved migration plan and are not open questions:

| # | Approved decision | Notes for implementation |
| --- | --- | --- |
| A1 | **shadcn/ui on Tailwind CSS**, initialised in `apps/web` (`npx shadcn init`) | Components are copied into the repo (no runtime UI library dependency) |
| A2 | **Map the current brand colours (`#198754` etc.) to CSS variables** | §2.1 lists the tokens; `--primary` is `#16794a` (P1 approved) |
| A3 | **Replace ad hoc classes with `Button`, `Select`, `Input`, `Label`, `Card`, `Dialog`, `Tabs`, `Sheet`, `Sonner`** | `Dialog` replaces the admin delete confirmation (Phase 5G uses an inline `alertdialog` without new dependencies); `Tabs` for admin; `Sheet` for the mobile menu (and cart drawer); `Sonner` for "added to cart" |
| A4 | **One page per commit, visual check at 375 px and 1280 px after each** | The Playwright projects and screenshots (MIGRATION_PLAN.md 5F/5G) are the evidence; add a 375 px project |
| A5 | **Acceptance: no visual regressions; form accessibility equal or better** | Today's baseline: axe 0 serious/critical, field errors linked (5G), keyboard and forced-colours tests passing |
| A6 | Phase 6 starts only **after functional parity** | Parity reached in 5G except the items listed in MIGRATION_PLAN.md 5G "Remaining gaps" |

### Owner decisions P1–P8 — **approved 2026-10-22**

| # | Decision | Implemented in |
| --- | --- | --- |
| P1 | Primary colour **forest green `#16794a`** (5.43:1 with white); `#198754` is retired | 6A (tokens) |
| P2 | **Yellow Add to Cart replaced by the green primary button** | 6A (`AddToCartControls`) |
| P3 | **Inter** typography via `next/font/google` (self-hosted at build) | 6A |
| P4 | **Product sorting** (`?sort=`) — built in 6B as name A–Z / Z–A and price low–high / high–low (the owner's 6B brief); rating sort not built | 6B (products page) — see §9 |
| P5 | **Professional footer** — navigation and only true statements (no invented address, policies or reviews) | 6A |
| P6 | **Dark mode deferred** — tokens are ready for a dark theme; none is defined or shipped | later |
| P7 | **Show/hide password** toggle (`aria-pressed`) | authentication pages (not in 6B; planned for a later 6 task) |
| P8 | **Maximum content width 1280 px** (`max-w-7xl`) shared by header, content and footer | 6A (`Container`) |

Visual direction: polished, minimal, premium — neutral white/near-white surfaces, one green for actions,
the deep brand green for header and footer, consistent spacing and radii, accessible contrast and product
photography on quiet tiles.

## 1. Where the UI is today (inspected, Phase 5F; updated 5G)

| Aspect | Current state | Consequence |
| --- | --- | --- |
| Styling | Tailwind 4 utility classes written inline in 17 client and ~15 server components; `globals.css` only sets body colour | Every page re-states button, card, field and alert styles |
| Colour | Hard-coded hex values: `#198754` (28 uses), `#08783e` (18), `#084f2d` (10), `#126c45` (6), plus one-off `#ffd814` Add to Cart yellow, `#baffbe` search button, Tailwind `slate`/`red`/`amber`/`green` scales | No tokens, no dark mode, three greens doing similar jobs, a yellow CTA that appears nowhere else |
| Typography | Browser default sans-serif, sizes chosen per page (`text-xl` … `text-4xl`) | No type scale; headings differ between pages (`Your cart` 3xl, `Sign in` 2xl, `Page not found` xl) |
| Radius / elevation | `rounded` (38), `rounded-md` (18), `rounded-lg` (15), `rounded-full` (7); `shadow-sm`/`shadow-2xl` ad hoc | Inconsistent card and control shapes |
| Layout | Root `<main>` is `max-w-5xl` (1024 px) while the header spans 1800 px | Desktop catalogue shows 5 columns in a narrow band (Vite filled the width with up to 8); header and content edges do not align |
| Buttons | 6+ inline variants (green solid, green outline, yellow pill, red solid, slate-900 solid, underlined text) | Primary action looks different on product, cart, sign-in and account pages |
| Forms | Sign-in, registration and admin forms link each error to its field (`aria-describedby`, `aria-invalid`, focus to the first error) since 5G; checkout uses native validation | Error styling differs per form; checkout has no custom per-field messages |
| Overlays | Hand-written cart drawer (focus trap added in 5F) and mobile menu popover | Works, but a second modal would duplicate the focus logic |
| Feedback | 2-second inline "Added N to your cart" text | Easy to miss, no global toast region |
| Copy | Internal wording removed from customer pages in 5G ("Order summary", "Order total", "Price paid") | Keep plain language in new components |

Strengths to keep: semantic landmarks, labelled controls, real 404/307 status codes, server-rendered
catalogue, `next/image` with fixed boxes (measured CLS ≤ 0.0007), axe-clean pages (0 violations on 12
pages in 4 engine/layout combinations), keyboard-reachable header, visible focus rings.

## 2. Design system

Built on **Tailwind CSS 4 + shadcn/ui** (Radix primitives, copied into `src/components/ui`, owned by us).
Tokens are CSS variables in `globals.css` (`@theme inline`), so light/dark themes and future brand
changes touch one file.

### 2.1 Colour tokens (light; dark mode defined alongside, off by default until reviewed)

| Token | Value (light) | Use | Contrast |
| --- | --- | --- | --- |
| `--background` | `#ffffff` | page | — |
| `--surface` | `#f7f8f7` | cards on tinted sections, summaries | — |
| `--foreground` | `#0f1a14` | body text | 17.8:1 on white |
| `--muted-foreground` | `#56635b` | secondary text | 6.3:1 on white |
| `--border` | `#e1e6e2` | dividers, card edges | non-text |
| `--brand` | `#084f2d` (existing header green) | header, footer, brand marks | 9.7:1 with white text |
| `--primary` | `#16794a` | primary buttons, links | 5.4:1 with white (darkened from `#198754`, 4.5:1, to leave margin) |
| `--primary-hover` | `#126339` | hover/pressed | — |
| `--accent` | `#e8f5ee` | selected chips, selected delivery option | — |
| `--destructive` | `#b42318` | remove, sign out everywhere | 6.6:1 with white |
| `--warning-bg` / `--warning-fg` | `#fff7e0` / `#7a4a00` | "no payment provider", unavailable products | 7.0:1 |
| `--success-bg` / `--success-fg` | `#e8f5ee` / `#0b5a35` | order confirmed | 7.4:1 |
| `--ring` | `#16794a` | focus ring (2 px, 2 px offset) | ≥ 3:1 against adjacent colours |

The yellow Add to Cart button is retired: one primary colour for the main action on every page.
Contrast values are WCAG ratios computed from these hex values (2026-10-22) and must be re-checked with axe after implementation.

### 2.2 Typography

- Font: **Inter** via `next/font/google` (self-hosted at build, `display: swap`, latin subset), with
  `font-variant-numeric: tabular-nums` on prices and totals. Fallback: system UI stack.
- Scale (rem, line height): `xs .75/1rem`, `sm .875/1.25`, `base 1/1.5`, `lg 1.125/1.75`, `xl 1.25/1.75`,
  `2xl 1.5/2`, `3xl 1.875/2.25`, `4xl 2.25/2.5`.
- Roles: page title `3xl` semibold (`2xl` below `sm`); section title `xl` semibold; card title `base`
  semibold; price `lg` semibold tabular; body `base`; meta/help `sm` muted.

### 2.3 Spacing, radius, elevation, breakpoints

- Spacing on the 4 px Tailwind scale; page gutters `px-4` (< 640), `px-6` (≥ 640), `px-8` (≥ 1024).
- Content width: `max-w-7xl` (1280 px) for catalogue and orders; `max-w-3xl` for forms (sign-in,
  register, account); checkout `max-w-6xl` two-column. Header inner width matches the content width.
- Radius tokens: `--radius-sm 6px` (inputs, chips), `--radius 10px` (cards, buttons), `--radius-lg 16px`
  (drawers, dialogs), `full` (badges, counters).
- Elevation: `shadow-xs` (cards), `shadow-lg` (drawers, menus) only.
- Breakpoints (Tailwind defaults): `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`. The header
  switches to its full navigation at `lg` (today `xl`), because tablets at 1024 px have room.

### 2.4 Components (shadcn/ui unless noted)

| Component | Replaces | Notes |
| --- | --- | --- |
| `Button` (variants `primary`, `secondary`, `outline`, `ghost`, `destructive`, `link`; sizes `sm`, `md`, `lg`, `icon`) | all inline button styles, `utils/tailwindClasses.ts` in Vite | min target 44×44 px on touch layouts; `aria-busy` + spinner while pending |
| `Input`, `Label`, `Form` field wrapper (ours: `Field` with label, description, error) | inline inputs | error text linked with `aria-describedby`, `aria-invalid` set; first invalid field focused on submit |
| `Select` (native `<select>` styled) | quantity selects | keep native for mobile pickers and accessibility |
| `RadioGroup` | delivery options | card-style options with price and date |
| `Card` | ad hoc bordered `article`s | header/content/footer slots |
| `Sheet` | `CartDrawer`, mobile menu | Radix handles focus trap, Escape, scroll lock and focus return (replaces the 5F hand-written logic) |
| `DropdownMenu` | signed-in account menu on desktop | name, Account, Orders, Sign out |
| `Badge` | status text, cart counter | order status colours from tokens |
| `Alert` | red/amber/green boxes | variants `info`, `warning`, `destructive`, `success` |
| `Sonner` toast | 2-second "Added N" text | `aria-live="polite"` region; action "View cart" |
| `Skeleton` | `animate-pulse` divs | same box sizes as final content (keeps CLS ≈ 0) |
| `Separator`, `Breadcrumb` | hand-drawn borders, "← Back" links | |
| Ours: `ProductCard`, `Price`, `RatingStars`, `QuantitySelect`, `OrderSummary`, `OrderLine`, `EmptyState`, `PageHeader` | duplicated markup | see 2.5 |

### 2.5 Duplication to remove

- **Order summary** (items/shipping/tax/total) is written three times: `CartPageClient`, `CheckoutPageClient`,
  `CartDrawer`. → one `OrderSummary` component.
- **Empty states** ("Your cart is empty", "No orders yet", "No products match") → `EmptyState` (icon, title, text, action).
- **Quantity 1–10 select** in `AddToCartControls` and `CartPageClient` → `QuantitySelect`.
- **Add to cart**: `AddToCartControls` posts directly while `useAddCartItem` exists → use the hook everywhere.
- **Product line rows** (cart, checkout review, order card, drawer) → `OrderLine` with size variants.
- **Status / error / warning boxes** → `Alert`.
- **Page titles** (inconsistent sizes) → `PageHeader` (title, description, actions).
- **Date and money formatting** is already central (`lib/format.ts`, `formatMoney`) — keep.

## 3. Navigation pattern

- Header (sticky, `--brand` background): logo · search (expands to full width below `md`) · on `lg+`:
  Orders, cart icon button with count badge (opens the cart `Sheet`), account `DropdownMenu` (or Sign in /
  Register). Below `lg`: search row, cart button and a `Sheet` menu.
- The cart button opens the drawer; "View cart" and "Checkout" live inside it (today they are separate
  header links "Cart", "Preview", "Checkout").
- Category chips become a horizontally scrollable `ToggleGroup` on mobile.
- Footer (new, minimal): store name, links to Orders/Account, "No payment provider is connected" notice
  while that is true.
- Skip link "Skip to content" as the first focusable element.

## 4. Page-by-page tasks (one page per commit; screenshot review at 375, 768, 1280 px after each)

1. **Foundation** — tokens, Inter, `Button`, `Field`, `Card`, `Alert`, `Badge`, `Sheet`, `Sonner`, `Skeleton`,
   `PageHeader`, `EmptyState`; header/footer/skip link; widen content to `max-w-7xl`. Re-run axe + browser suite.
2. **Home** — hero band with search and category entry points; "All products" grid (2/3/4/5/6 columns at
   `sm/md/lg/xl/2xl`); cards with image, name (2 lines), rating, price, quick add. Keep server rendering and
   the first-row `preload`.
3. **Products (search/filter)** — `PageHeader` with result count; chips; sort control (price, rating; URL
   `?sort=`) only if approved — it is new behaviour; empty state with "Clear search".
4. **Product details** — two columns from `md`; breadcrumb; gallery box (fixed aspect); price, rating,
   quantity, primary Add to cart, toast; description sections in an accordion on mobile; JSON-LD unchanged.
5. **Cart** (page + drawer) — `OrderLine` rows with quantity and remove; delivery `RadioGroup`; sticky
   `OrderSummary` on `lg`; unavailable-product `Alert` keeps checkout disabled; drawer shows the same summary.
6. **Checkout** — stepper (Details → Review) with `aria-current="step"`; `Field`s with inline errors and
   focus on first error; address grouped; review card with edit links; the no-payment notice as a
   `warning` `Alert`; one primary "Place order"; idempotency behaviour unchanged.
7. **Orders and order details** — list of order `Card`s with status `Badge`, date, total, thumbnails;
   details page with timeline (placed → shipped → delivered) using the existing tracking rules; Buy again
   and Track package as secondary/outline buttons; customer-facing copy ("Total paid" → "Order total",
   no "Stored total"/"Historical" wording).
8. **Tracking** — progress stepper + progress bar using the same tokens; delivery date prominent.
9. **Authentication** — centred `Card` (max 420 px) for sign-in and register; field-level errors; password
   requirements as `Field` description; show/hide password toggle (`aria-pressed`); notices as `Alert`.
10. **Account** — profile `Card`; sign-out actions; "Sign out on all devices" behind a confirmation
    `AlertDialog` (destructive).
11. **Error, 404, loading** — `EmptyState` variants; skeletons that match final layouts.

12. **Admin** (migrated in 5G) — `Tabs` or side navigation for Dashboard/Products/Orders; `Card` statistics;
    data table for products (sortable, keeps the mobile list); `Dialog` for delete (A3); status change as a
    `Sheet` or inline form with `Select` + `Textarea`; status history as a timeline. Same role checks and tests.

## 5. Accessibility requirements (acceptance criteria for every task)

- WCAG 2.1 AA: axe (`npm run test:browser`) reports **0 serious/critical** violations; contrast ≥ 4.5:1
  text, ≥ 3:1 UI components and focus indicators.
- Every control reachable and operable by keyboard in a logical order; visible focus ring (`--ring`);
  skip link; no keyboard traps except inside modal sheets, which return focus on close.
- Form fields: visible label, description and error linked by `aria-describedby`, `aria-invalid` on
  error, errors announced (`role="alert"` once per submit), focus moves to the first invalid field.
- Live regions for cart updates (toast) and async status; no information conveyed by colour alone
  (status badges carry text).
- Touch targets ≥ 44×44 px below `lg`; no horizontal scrolling at 320 px; text resizable to 200 %.
- `prefers-reduced-motion` disables sheet/toast animations.
- Manual checks per release: keyboard-only pass, NVDA + Firefox and VoiceOver + Safari (iOS) spot checks
  of sign-in, add to cart, checkout and orders. Automated checks do not replace these.

## 6. Responsive and performance requirements

- Layouts verified at 375, 390 (iPhone 14), 412 (Pixel 7), 768, 820, 1024, 1280, 1366 and 1536 px in
  Chromium, Firefox and WebKit (existing Playwright projects plus a 1024 px project).
- Keep: server-rendered catalogue, `next/image` with explicit `sizes`, fixed image boxes, CLS < 0.1
  (measured today ≤ 0.0007), no new client JavaScript on server pages without a reason. shadcn/Radix
  components are client components — use them only in interactive islands.
- No hydration warnings in any engine (the browser suite fails on them).

## 7. Out of scope / decisions needed before Phase 6 starts

- ~~Decide the pending items P1–P8~~ — approved (section 0).
- Admin redesign is task 12 (the admin area was migrated in Phase 5G).
- Images to object storage/CDN (see MIGRATION_PLAN.md 5D) — independent of the redesign.

## 8. Phase 6A — what was built (2026-10-22)

**Dependencies** (exact versions, `npm audit` 0): `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.7.0`.
shadcn/ui is set up by hand — `components.json`, `cn()` in `src/lib/utils.ts`, components in `src/components/ui`
written in the shadcn source style — instead of `npx shadcn init`, which rewrites `globals.css` and adds
`lucide-react` and `tw-animate-css`. No Radix package yet: links styled as buttons use `buttonVariants()` (no
`asChild`/Slot), and the five icons are inline SVGs.

**Tokens** (`src/app/globals.css`, `:root` + `@theme inline`): `background`, `foreground`, `surface`, `card`, `muted`,
`muted-foreground`, `border`, `input` (`#7b8780`, 3.74:1, so field borders meet WCAG 1.4.11), `brand`, `primary`
(+ `hover`, `foreground`), `secondary`, `accent`, `destructive` (+ `hover`), `success`, `warning`, `ring`; radii
`sm` 6 px, `md` 10 px, `lg` 16 px; `--font-sans` is Inter. Focus: a `focus-ring` utility and a base `:focus-visible`
rule, both a 2 px **outline** (kept in forced-colours mode, unlike a box-shadow ring); header and footer set `--ring`
to white. `prefers-reduced-motion` shortens every transition and animation.

**Components:** `ui/button` (variants default, secondary, outline, ghost, destructive, link, inverse; sizes default,
sm, lg, icon; 44 px targets below `lg`), `ui/input`, `ui/label`, `ui/card` (header, title, description, content,
footer), `ui/badge`, `ui/skeleton`, `ui/icons`; `layout/Container` (1280 px) and `NarrowContent` (1024 px for pages
not yet redesigned), `layout/SiteFooter`, `layout/SectionNav` (account and admin sub-navigation with
`aria-current`), `layout/EmptyState`; catalogue `Price`, `cart/QuantitySelector`, restyled `ProductCard`,
`ProductGrid` and `RatingStars`; skip link in the root layout.

**Deliberate deviations from this spec:**
- The header switches to its full navigation at `xl` (1280 px), not `lg`: signed in it has seven items (Orders,
  Admin, account name, Checkout, cart preview, Cart, Sign out), which squeeze the search box at 1024 px. Revisit
  if 6B moves Checkout and Sign out into an account menu.
- `Sheet`, `Dialog`, `DropdownMenu` and `Sonner` (Radix) are not added in 6A. The hand-written cart drawer and
  mobile menu keep their tested focus handling (5F) and are restyled only; adopting Radix is a 6B decision.
- Page internals (cart quantity select, checkout fields, order cards, admin tables) keep their markup until their
  6B task.

**New browser checks:** signed-in header (desktop: cart link with count; compact: Menu opens a panel, Escape closes it
and returns focus to the button) and footer navigation on every project; customer reflow also at 375 and 768 px;
admin pages reflow at 320, 375, 683 (200 % zoom) and 768 px (Chromium).

**Verification (final run, 2026-10-23, on the final build):** typecheck, lint, `npm audit` 0; unit/component
**186/186**; proxy e2e **52/52**; pages e2e **81/81**. Browser suite (6 projects):
- run 1: 117 passed, **2 failed**, 2 flaky, 23 skipped — Firefox account flow and WebKit-mobile admin order status.
  Both are the known stalls (MIGRATION_PLAN.md 5G): in WebKit the link was rendered and visible but never became
  "stable" (no animation frames); in Firefox the page stopped after a request (no navigation after sign-in, header
  not updated after sign-out). Re-run in isolation (`--repeat-each=3`, Firefox + WebKit mobile): 22 passed, 0 failed,
  2 flaky (Firefox account flow, passed on retry);
- run 2: **121 passed, 0 failed, 0 flaky**, 23 skipped.
- Screenshots reviewed: signed-in header and footer at 1366 px, open mobile menu at Pixel 7 width.
- An earlier run started on 2026-10-23 01:36 was interrupted before finishing (no report); it is not counted.

## 9. Phase 6B — home, catalogue, sorting and product details (2026-10-23)

**Pages updated** (cart, checkout, orders, account, auth and admin untouched):
- **Home (`/`)** — no longer the full listing. A brand-green hero with counts from the catalogue ("6 products · 4
  categories"), the category names and the **highest-rated product** as a spotlight (its photo is the only preloaded
  image); "Shop by category" cards (one per category, product count, the category's top-rated photo as a decorative
  image, link to `/products?category=`); a "Top rated" row of four cards; an entry point to the full catalogue. Copy
  is limited to what the data says: no discounts, testimonials, statistics or product claims. The meta description is
  built from the real category names. Old listing links (`/?q=`, `?category=`, `?sort=`) are **307 redirects** to
  `/products` with the query passed along (`next.config.ts`: a redirect from the page would arrive after the 200
  streamed by its loading skeleton).
- **Listing (`/products`)** — heading and live result count, category chips and the sort control in one toolbar,
  category on each card, empty states for "no match" (with "Search all categories" when a category is also set), an
  empty category and an empty catalogue; skeletons match the toolbar and cards. Canonical stays `/products`.
- **Product details (`/products/[id]`)** — breadcrumb (Home / Products / category / product, `aria-current="page"`),
  two columns from `md` with a fixed square image tile (sticky on wide screens), category link, rating, a purchase
  card (price, quantity, green Add to Cart — the existing `AddToCartControls`, unchanged), highlights with check
  icons, information cards and "More in {category}" (up to four others, top rated first). Metadata, canonical URL,
  JSON-LD and the genuine 404 (also for deleted products) are unchanged; the 404 page uses `EmptyState`.

**Sorting rules** (`sortProducts`, `src/features/catalog/product.ts`):
- `?sort=` accepts exactly `name-asc`, `name-desc`, `price-asc`, `price-desc`; anything else (or none) keeps the
  catalogue's own order — never an error.
- Names compare with `Intl.Collator("en", { sensitivity: "base", numeric: true })` (case-insensitive, "Item 2" before
  "Item 10", same result on server and client). Prices compare in whole cents.
- Ties are total and deterministic: equal names → cheaper first → id; equal prices → name A–Z → id. Name Z–A reverses
  only the name comparison. The result never depends on the API's row order (unit-tested with reversed input).
- "Top rated" (home, related products): highest average, then most ratings, then name, then id; unrated products are
  left out.
- Sorting happens on the server, in the page, from the cached catalogue (`getCatalog`, 60 s, tag `catalog`); there is
  no product state in Redux or TanStack Query, so admin create/edit/delete invalidation (`revalidateTag("catalog")`)
  covers every new page.

**Sort control** (`SortControl`, the only new client component): a native `<select>` labelled "Sort by" in a GET form
with the search and category as hidden fields. Without JavaScript a `<noscript>` Apply button submits it (no layout
shift on hydration). With JavaScript a choice navigates at once with `router.push` (a history entry: Back/Forward
restore each order; scroll kept); `useOptimistic` shows the choice immediately and the form is `aria-busy` while
loading. The listing updates in place, so focus stays on the select (verified in all engines). The result-count
status adds ", sorted by …" for screen readers. A native select was chosen over a Radix/shadcn `Select` for the
platform picker on phones and full keyboard/AT support with no new dependency (spec §2.4 already specifies a styled
native select).

**Components reused:** `Container`, `Card`, `Badge`, `buttonVariants`, `EmptyState`, `Skeleton`, `Price`,
`RatingStars`, `ProductImage` (new `decorative` option), `ProductCard`/`ProductGrid` (new `headingLevel`,
`preloadCount`, `className`; category line), `AddToCartControls`/`QuantitySelector` (unchanged: quantity 1–10,
sign-in redirect with return path, cart mutation and its query invalidation). New: `HomeSections`
(`HomeHero`, `CategoryGrid`, `SectionHeader`), `SortControl`, `CheckIcon`, helpers `parseSort`, `sortLabel`,
`sortProducts`, `topRated`, `categorySummaries`, `catalogHref`. No new dependencies.

**Verification (final, 2026-10-23, on the final build):** typecheck, lint, `npm audit` 0; unit/component **205/205**
(+19); proxy e2e **52/52**; pages e2e **92/92** (+11: home sections, top-rated tie order, single hero preload,
legacy 307s, listing with every product, sort order in server HTML, sort + category, no-JS form, canonical, unknown
sort ignored). Mutation checks: removing the name tie-break, `push` → `replace`, chips dropping `sort` and letting
unrated products into "Top rated" each fail the new tests. Browser suite — see MIGRATION_PLAN.md 6B for every run;
final full run 132 passed, 1 failed, 1 flaky, 28 skipped, both Firefox navigation stalls; Firefox alone 22/22 twice
with retries off. Measured CLS (local `next start`, Chromium, not field data): desktop 0.0005 on home, listing and
product; mobile 0.0000–0.0034. Encoded script transfer on the home page 183.9 KiB (5F: 172.7 KiB).

**Screenshots reviewed** (Chromium 1366 px, 820 px tablet, Pixel 7): home, sorted listing, product details — no
overlap, clipping or sideways scrolling; the purchase card keeps a reserved line under the button for the "Added N
to your cart" message (deliberate, no layout shift).

**Not done / deviations:** rating sort (P4 mentioned it; the 6B brief listed name and price only); category chips
wrap rather than scroll horizontally on phones; no toast (`Sonner`) for add to cart — the existing inline live
message stays; no accordion for product information on mobile (cards instead, so headings stay plain `h2`s).
Screen-reader testing of search, filters and sorting is still manual (`docs/ACCESSIBILITY_MANUAL_CHECKLIST.md`).

## 10. Phase 6C — cart drawer, cart, checkout, orders and tracking (2026-10-23)

**Pages redesigned:** cart drawer, `/cart`, `/checkout` (details, review, failure states), `/orders`,
`/orders/[id]` (including the `?placed=1` confirmation), `/tracking`, and the order/tracking 404 pages. These pages
now use a 1152 px width (`CommerceContent`, `max-w-6xl`) instead of the 1024 px `NarrowContent`. Account and auth pages
are unchanged. No API, business rule, query key, Redux state or backend file changed.

**Components** (new unless marked):
- `ui/alert` (shadcn Alert: info, success, warning, destructive; no Radix) — every error, notice and confirmation box.
- `cart/OrderSummary` — **replaces three hand-written copies** (drawer, cart page, checkout aside). It only shows the
  API's `GET /payment-summary` figures (items, shipping — "Free" at 0 — total before tax, tax, order total); nothing
  is added up in the browser. Compact variant in the drawer.
- `cart/CartLine` — `CartLineRow` (cart page: photo, name, unit and line price, `QuantitySelector` 1–10, delivery
  option radio cards, Remove; a deleted product stays as "This product is no longer available" with "Remove
  unavailable item") and `CartLineCompact` (drawer and checkout review: photo, name, quantity, delivery date, line
  price). Line prices are current price × quantity for display only and are labelled "Item total".
- `checkout/CheckoutSteps` (step list, `aria-current="step"`, "Step N of 2" in text, tick + "(completed)" for done
  steps), `checkout/customer` (field rules mirroring `POST /api/orders`: every field non-empty after trimming, the same
  loose email shape; the server still validates), `placeOrderMessage` (one message per failure class).
- `orders/OrderStatus` (`OrderStatusBadge`: status as text, colour only repeats it; "Not recorded (older order)" for
  MongoDB orders), `orders/OrderCard` + `OrderLineItem` (redesigned; shared by list and details), restyled
  `BuyAgainButton`, `EmptyState`/`Skeleton` loading, empty and error states everywhere.
- Reused: `Button`/`buttonVariants`, `Card`, `Input`, `Label`, `Badge`, `QuantitySelector`, `ProductImage`
  (decorative where the product name is next to it), `formatMoney`, `lib/format` dates.

**Decisions and differences from 6B:**
- **No Radix `Sheet` for the drawer.** The existing drawer already does everything a Sheet would (focus in, Tab trap,
  Escape, scroll lock, focus return incl. the Safari opener fix from 5F) and is covered by the browser suite; it was
  restyled only (brand header, count, thumbnails, skeleton, retry, empty state, shared summary). A slide-in runs only
  under `motion-safe` (tested: no animation with reduced motion). Same reasoning as 6B's native `<select>`.
- **Checkout validation is now in-page** (`noValidate`): each field's error is linked with `aria-describedby`,
  `aria-invalid` is set, focus moves to the first invalid field, and an edit clears that field's error — the 5G sign-in
  pattern. 5F/5G used the browser's native messages. Step changes move focus to the step heading.
- **Idempotency unchanged** (one key per reviewed set of details in a ref; retries reuse it, edited details get a new
  key; the server answers 422 for a reused key with different details). A pending order disables the button and sets
  `aria-busy`; a second click sends nothing (tested). Failures: network → "will not be placed twice … check your
  orders"; 409 → message + "Review your cart"; 401 → sign in again; 403 → refresh; 400/422 → the server's message.
- **The no-payment notice moved out of the global footer** (now "Prices are shown in US dollars.") and is shown on the
  checkout review step (warning Alert), the confirmation ("No payment was processed") and order details ("No payment
  was taken").
- **Prices on orders:** PostgreSQL lines show "Price paid: $x each" from the immutable snapshot; MongoDB lines (current
  product returned) show "Price paid not recorded" and "Current price $y (not the price paid)"; missing products show
  "Product details not recorded" / "Image not available". The order total is the stored `totalCostCents`.
- Order details shows the status once (page header), a stored-total card and the delivery address; the list says
  "newest first" (both repositories sort by order time descending). Tracking: status badge, product, three-stage
  stepper and the existing progress bar; the text says progress is estimated and no courier tracking is connected.
- **Accessible names:** per-product names ("Quantity for …", "Delivery option for …", "Remove …"); visually hidden
  name parts never start with a space inside the hidden span (an accessible-name computation trimmed it: "Quantityfor").
- **Forced colours:** links styled as buttons (and every button variant except `link`) get a border in the system
  text colour; native radios are drawn by the system and keep their option card border (screenshot checked).
- **Layout bug found and fixed:** a long unbroken email on order details widened the page by 11 px in Firefox
  (`break-words` does not lower a grid column's minimum width). Two-column grids are now `minmax(0,1fr)` and
  addresses/emails use `overflow-wrap: anywhere`; checked with a 120-character email in all three engines.

**Verification (2026-10-23, final build):** typecheck, lint, build, `npm audit` 0 (web, backend, Vite); unit/component
**220/220** (+15; mutation checks: a client-side total, no double-submit guard, a current price shown as paid, no
focus on the first error and a new key on every review each fail a test); proxy e2e **52/52**; pages e2e **92/92**;
backend MongoDB **212 passed, 9 todo**, PostgreSQL **264/264**; Vite **47/47**. Browser suite, Firefox run separately:
final Chromium + WebKit **120 passed, 0 failed, 0 flaky, 25 skipped**; Firefox alone **23 passed, 0 failed, 0 flaky,
6 skipped** (after these runs only a link's underline class changed; the commerce spec was re-run on that build:
12/12 Chromium/WebKit, 4/4 Firefox). Earlier 6C runs and the stall analysis: MIGRATION_PLAN.md 6C.

**Screenshots reviewed** (1366 px, 820 px, Pixel 7): cart, checkout errors, review, confirmation, orders, tracking,
drawer, forced colours — no overlap or clipping; one inconsistency fixed (the two "Change" links styled alike).
