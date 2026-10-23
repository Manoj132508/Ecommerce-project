# Manual accessibility checklist (Next.js storefront and admin)

Status: **not yet performed.** Automated checks pass (see MIGRATION_PLAN.md 5F/5G: axe WCAG 2.0/2.1 A/AA in
Chromium, Firefox and WebKit; keyboard, focus, 200 % zoom/320 px reflow and forced-colours tests in
Playwright). Automated checks find only part of the problems. Record the result of each item below with the
date, tester, browser, assistive technology and version; do not mark an item as passed without doing it.

## Set-up

- Run the stack locally (MIGRATION_PLAN.md "Local development commands") with a **test** database, a customer
  account and an admin account. Never use production data.
- **NVDA** (latest) with **Firefox** and with **Chrome** on Windows. Browse mode and focus mode both.
- **VoiceOver** with **Safari on iOS** (iPhone, rotor + swipe) and **Safari on macOS** if available.
- Reset between runs: sign out, clear site data.

## 1. Every page (repeat on each page you visit)

| # | Check | NVDA | VoiceOver iOS |
| --- | --- | --- | --- |
| 1.1 | The page title is announced on load and after client-side navigation (Next.js route announcer). | ☐ | ☐ |
| 1.2 | Landmarks list: banner, search, main navigation, main; admin pages also "Admin sections". | ☐ | ☐ |
| 1.3 | Headings list starts with one level-1 heading that names the page; no skipped levels that confuse. | ☐ | ☐ |
| 1.4 | Every link and button has a meaningful name out of context ("Track package for …", "Edit …", "Delete …"). | ☐ | ☐ |
| 1.5 | Focus is always visible with the keyboard and never lands on hidden content. | ☐ | n/a |

## 2. Shopper journeys

| # | Steps | Expected | NVDA | VO iOS |
| --- | --- | --- | --- | --- |
| 2.1 | Search from the header for "sun"; open a category chip | Result count announced as status; the chip is announced as current | ☐ | ☐ |
| 2.2 | Open a product, change quantity, Add to Cart while signed out | Sign-in page with the notice read; after sign-in you return to the product | ☐ | ☐ |
| 2.3 | Sign in with an empty form, then a wrong password | Each field reads its own error ("Enter your email address."); a wrong password is read on both fields and focus returns to Email | ☐ | ☐ |
| 2.4 | Register with mismatched passwords; then an existing email | Focus moves to the first problem; "Passwords do not match." read with Confirm password; "User already exists" read with Email | ☐ | ☐ |
| 2.5 | Add to cart; "Added N to your cart" | The confirmation is announced (polite live region) | ☐ | ☐ |
| 2.6 | Open the cart drawer (Preview / Menu → Cart preview) | Dialog "Your cart" announced; focus on Close; Tab/swipe stays inside; Escape (or Close) returns focus to the opener | ☐ | ☐ |
| 2.7 | Cart page: change quantity and delivery option; remove an unavailable item | Changes announced; delivery options read as a radio group with dates and prices | ☐ | ☐ |
| 2.8 | Checkout: submit with Phone empty | The browser's required-field message is read and focus is on Phone | ☐ | ☐ |
| 2.9 | Review step and "Confirm and place order" | "Step 2 of 2" and the no-payment notice are read; the order confirmation heading is read after placing | ☐ | ☐ |
| 2.10 | Orders: Buy again, Track package | "Added to your cart" announced; tracking progress bar read with its value text (Preparing/Shipped/Delivered) | ☐ | ☐ |
| 2.11 | Let the session expire (or sign out in another tab) and act | Sign-in page with "Your session has expired" read | ☐ | ☐ |
| 2.12 | Home (6B): headings list (NVDA H / VO rotor); open a "Shop by category" card | One h1 "Shop everyday essentials", then h2 sections (Shop by category, Top rated, Browse the full catalogue) with h3 product cards; each category card is read as one link ("Accessories, 2 products"), its photo is silent | ☐ | ☐ |
| 2.13 | Listing (6B): change "Sort by" with the keyboard (NVDA: Alt+Down then arrows/Enter; VO: picker) | Combobox "Sort by" read with its value; focus stays on it after the list updates; the status "N products, sorted by …" is read (check whether NVDA announces it — if not, note it) | ☐ | ☐ |
| 2.14 | Listing (6B): browser Back after two sort changes and a category chip | Each Back restores the previous order and category; the select reads the restored value | ☐ | ☐ |
| 2.15 | Product details (6B): breadcrumb and "More in {category}" | Breadcrumb navigation read with the product as the current page; "Add to Cart" in the purchase card vs "Add {name} to cart" in related cards | ☐ | ☐ |

## 3. Admin journeys (admin account)

| # | Steps | Expected | NVDA | VO iOS |
| --- | --- | --- | --- | --- |
| 3.1 | Dashboard | Figures read as term/value pairs; the no-payment note is read | ☐ | ☐ |
| 3.2 | Add product, submit empty | Summary alert read; focus on Product name; each field reads its hint and error | ☐ | ☐ |
| 3.3 | Create, then edit a product | Saved message read as status after returning to the list | ☐ | ☐ |
| 3.4 | Delete a product | Confirmation read as an alert dialog with its explanation; focus on "Delete permanently"; "Keep product" returns focus to the row's Delete button | ☐ | ☐ |
| 3.5 | Order: change status without a reason | Focus on Reason; error read with its hint | ☐ | ☐ |
| 3.6 | Order: change status with a reason | "Status changed to …" read; the new entry appears in Status history | ☐ | ☐ |

## 4. Visual settings (no screen reader)

| # | Check | Result |
| --- | --- | --- |
| 4.1 | Browser zoom 200 % and 400 % at 1280 px wide: no sideways scrolling, nothing cut off, sticky parts do not cover content | ☐ |
| 4.2 | Windows Contrast themes (Aquatic, Desert, Night sky): every button, field, focus ring and selected chip visible | ☐ |
| 4.3 | Text spacing (WCAG 1.4.12 bookmarklet): no clipped text | ☐ |
| 4.4 | Reduced motion on: nothing animates in a way that matters | ☐ |
| 4.5 | Mobile landscape (iPhone): header, drawer and forms usable | ☐ |

## Reporting

For each failure note the page, steps, what was announced or shown, and the expected result, then add it to
MIGRATION_PLAN.md (Phase 5 remaining work) before the Phase 6 work on that page starts.
