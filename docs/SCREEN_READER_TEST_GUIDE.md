# Running the manual screen-reader pass

How to execute `docs/ACCESSIBILITY_MANUAL_CHECKLIST.md` with **NVDA + Firefox on Windows** and **VoiceOver + Safari on
iPhone**. Status: **not yet performed** — no item in the checklist has been ticked. Automated checks (axe, keyboard,
zoom, reflow, forced colours, reduced motion) do not replace it.

## Before you start (both)

- Use a **staging or local** build with throwaway data — never production. Locally: start the stack as in
  MIGRATION_PLAN.md §6 Phase 5 ("Local development commands"), with cookie sessions on.
- Create two accounts: a customer and an administrator (promote one in the local/staging database only).
- Put one product in the cart; place one order so Orders and Tracking have content; keep one product you may delete.
- Record for each checklist row: ✓ (as expected), ✗ (what you heard instead, and where), or "n/a". Note the screen
  reader, browser and versions at the top of the checklist.

## NVDA + Firefox (Windows)

1. Install NVDA (nvaccess.org) and current Firefox. Start NVDA (Ctrl+Alt+N). Set NVDA → Preferences → Settings →
   Browse mode → "Automatic focus mode for focus changes" on (default).
2. Keys you need: **Insert** is the NVDA key. Browse mode: **H** / **Shift+H** next/previous heading, **1–6** heading
   level, **D** landmarks, **K** links, **B** buttons, **F** form fields, **T** tables, **Ctrl+Alt+arrows** move in a
   table. **Insert+F7** lists links/headings/landmarks. **Insert+Space** toggles browse/focus mode. **Tab** moves
   between controls. **Escape** closes dialogs.
3. For each page in sections 1–3: press **Insert+Down arrow** (say all) once to hear the reading order; then use H, D,
   F and Tab as the row describes. For errors, submit the form and listen for what is announced without moving.
4. Dialogs (checklist 2.6, 2.21, 3.4): after opening, press **Insert+Up arrow** (current focus) — it should be the
   safe button; try **Down arrow** in browse mode: you should stay inside the dialog.
5. Live updates (2.5, 2.13, 2.16): perform the action and do nothing else for 3 seconds — note whether the status was
   spoken. NVDA may need focus mode for some live regions; write down which mode you were in.

## VoiceOver + Safari (iPhone)

1. Settings → Accessibility → VoiceOver → on (or triple-click the side button if set as the Accessibility Shortcut).
   Use Safari.
2. Gestures: **swipe right/left** next/previous item; **double-tap** activate; **two-finger swipe up** read all;
   **rotor** (two-finger rotate) → Headings / Links / Form Controls / Landmarks, then swipe up/down; **two-finger
   scrub (Z)** = Escape/back.
3. For each row: open the page, use the rotor for headings and form controls as the row describes, and swipe through
   the area being tested. For the quantity and sort pickers, double-tap opens the native picker; swipe up/down to
   change, then confirm.
4. Dialogs: after opening, swipe right repeatedly — VoiceOver should not leave the dialog; the scrub gesture should
   cancel and return focus to the button that opened it.
5. Phone width matters: the header collapses into **Menu**; the admin tables become cards — check that each value is
   still read with its column name (checklist 3.7).

## Recording results

- Edit the checklist directly (☐ → ✓/✗) and add a short note for every ✗ with the page, the step and the exact
  announcement. Commit it as its own change, with the date and tester.
- Any ✗ in a checkout, sign-in, error-announcement or dialog row is a **release blocker** until fixed and re-tested.
