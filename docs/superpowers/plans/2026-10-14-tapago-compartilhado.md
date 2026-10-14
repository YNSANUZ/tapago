# TáPago Compartilhado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native implementation in this session). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship TáPago as a multi-user app with secure Google login, group collaboration, live updates, immutable monthly payment records, a safe public summary, a standalone public repository, and the short URL.

**Architecture:** Keep the approved responsive frontend, package it as a small static Vite app, and use Supabase Auth + PostgreSQL/RLS/RPC/Realtime as the shared source of truth. Develop with local Supabase, then configure a dedicated cloud project and publish only the isolated `apps/tapago` repository and `/tapago/` assets after backup and verification.

**Tech Stack:** HTML, CSS, JavaScript ES modules, Vite, `@supabase/supabase-js`, Supabase CLI/PostgreSQL, Node built-in test runner, Playwright for browser journeys if available.

**Spec:** `docs/superpowers/specs/2026-10-14-tapago-compartilhado-design.md`

## Global Constraints

- No existing Supabase project, NEXO Contas data, credentials, or production data may be reused.
- All monetary database values are integers in centavos; display values are formatted as BRL.
- Only invited, verified Google emails can claim an existing participant profile.
- RLS is enabled on every exposed data table; server role keys never enter browser bundles or Git.
- Public pages expose only explicitly enabled aggregate fields and never query private participant tables anonymously.
- Previous monthly confirmations retain confirmed amount, timestamp, and confirming actor after future amount changes.
- Monthly recurring periods are unique per expense/month and created idempotently in `America/Sao_Paulo`.
- Production URL is `https://saiunodf.com/tapago/`; `/contas/` and shared portal files remain untouched.
- The public GitHub repository includes only reviewed TáPago source, migrations, tests, and sanitized docs.
- Do not add a free-form chat or process/transfer PIX payments in this release.

## Review Focus

- A participant tries to read or mutate a different group's data; RLS denies it.
- A same-name user with a different Google email tries to accept an invitation; acceptance fails.
- An invitation is expired, revoked, replayed, or redeemed twice; only one valid redemption succeeds.
- A public visitor guesses an internal UUID or revoked slug; no private data is returned.
- Concurrent confirmations or repeated month initialization occur; totals and occurrences remain correct without duplicates.

---

### Task 1: Isolated application scaffold and public-repository boundary

**Files:**
- Create: `package.json`, `vite.config.js`, `.gitignore`, `.env.example`, `README.md`, `SECURITY.md`
- Modify: `index.html`, `app.js`, `styles.css` only when migrating the current prototype entry point
- Test: `test/repository-boundary.test.mjs`

**Interfaces:**
- Produces `npm run dev`, `npm run build`, `npm test`, and documented environment variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

- [ ] **Step 1: Write failing repository-boundary tests** asserting no parent workspace files are staged, `.env` and service role keys are ignored, no credential-like values occur in distributable files, and the public app build contains only `apps/tapago` assets.
- [ ] **Step 2: Run `npm test` and verify the boundary tests fail against the current unconfigured app.**
- [ ] **Step 3: Add the Vite/npm scaffold and secret-safe configuration; keep `.env.example` values empty and remove localStorage demo persistence from the production data path.**
- [ ] **Step 4: Run `npm test` and `npm run build`; verify output paths are rooted under `dist/`.**
- [ ] **Step 5: Commit the isolated scaffold.**

### Task 2: PostgreSQL schema, membership model, and RLS policies

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/0001_core.sql`, `supabase/tests/database/rls.test.sql`
- Test: `supabase/tests/database/rls.test.sql`

**Interfaces:**
- Produces tables for profiles, groups, memberships, invitations, fee participants, monthly contributions, payment notices/events, expense templates/occurrences, and public shares.
- Money columns use integer centavos; all timestamps use `timestamptz`; period keys use `date` month starts.

- [ ] **Step 1: Write SQL assertions** for group/member visibility, admin versus participant writes, personal profile privacy, historical-member authorization, and anonymous denial.
- [ ] **Step 2: Run `supabase test db`; verify expected policy failures before migrations exist.**
- [ ] **Step 3: Create the core migration with foreign keys, unique constraints, indexes, triggers, RLS policies, and role helper functions with a fixed `search_path`.**
- [ ] **Step 4: Run `supabase db reset` and `supabase test db`; verify cross-group reads/writes are denied and authorized reads pass.**
- [ ] **Step 5: Commit schema and RLS.**

### Task 3: Secure invitations and Google identity linking

**Files:**
- Create: `supabase/migrations/0002_invitations.sql`, `src/auth.js`, `src/invitations.js`, `supabase/tests/database/invitations.test.sql`
- Modify: `src/main.js`, `index.html`
- Test: `supabase/tests/database/invitations.test.sql`, `test/invitations.test.mjs`

**Interfaces:**
- `signInWithGoogle(): Promise<void>` starts OAuth with the final app callback.
- `createInvitation(groupId, email, participantId): Promise<{ inviteUrl, expiresAt }>` returns a copyable one-use link; database stores only the token hash.
- `acceptInvitation(token): Promise<void>` redeems only when the authenticated, verified email matches, before expiry, and the token is unused/unrevoked.

- [ ] **Step 1: Write failing tests** for exact email match, normalized case, different name/same name, invalid signature/token, expiry, revocation, replay, and account already linked.
- [ ] **Step 2: Run the tests and confirm all invitation behaviors fail without the RPCs.**
- [ ] **Step 3: Add transactional invitation RPCs and Supabase Google sign-in; never trust a participant name or client-supplied UID.**
- [ ] **Step 4: Run SQL and Node tests; verify acceptance links the existing participant and a linked account gets the Google avatar.**
- [ ] **Step 5: Commit invitation flow.**

### Task 4: Fee contributions, notices, confirmations, and member Realtime

**Files:**
- Create: `supabase/migrations/0003_payments.sql`, `src/groups.js`, `src/realtime.js`, `test/amounts.test.mjs`, `supabase/tests/database/payments.test.sql`
- Modify: `src/main.js`, `styles.css`
- Test: `test/amounts.test.mjs`, `supabase/tests/database/payments.test.sql`

**Interfaces:**
- `getGroup(groupId): Promise<GroupView>` reads only a group the user can access.
- `updateContribution(groupId, participantId, month, amountCents): Promise<void>` is admin-only and rejects a locked/confirmed historical period.
- `submitPaymentNotice(groupId, participantId, month): Promise<void>` only records the caller's notice and is idempotent per period.
- `resolvePaymentNotice(noticeId, decision): Promise<void>` is admin-only; `decision` is `confirmed | rejected`; confirmed events append amount, timestamp, and actor.
- `subscribeToGroup(groupId, onChange): Channel` provides private, membership-authorized change notifications; clients reload persisted rows after each event.

- [ ] **Step 1: Write failing tests** for R$ 440,00 sample totals, fractional-real cent values, admin/member authorization, idempotent notice, confirmation/rejection, append-only history, and two-member Realtime refresh.
- [ ] **Step 2: Run tests to verify missing functions and policies fail.**
- [ ] **Step 3: Add transactional payment RPCs, constraints, private Realtime authorization, and a data adapter used by the fee screen.**
- [ ] **Step 4: Run SQL/Node tests and a two-session browser journey; assert both clients show the same stored totals after the admin confirms.**
- [ ] **Step 5: Commit shared fee interactions.**

### Task 5: Monthly history and recurring expenses

**Files:**
- Create: `supabase/migrations/0004_periods.sql`, `src/periods.js`, `test/periods.test.mjs`, `supabase/tests/database/periods.test.sql`
- Modify: `src/main.js`
- Test: `test/periods.test.mjs`, `supabase/tests/database/periods.test.sql`

**Interfaces:**
- `ensureCurrentExpenseOccurrences(ownerId, localDate): Promise<Occurrence[]>` calls an idempotent RPC that creates at most one occurrence per expense and month.
- `getMonthlyHistory(groupId, year): Promise<MonthlySnapshot[]>` requires active membership and returns frozen monthly values and payment event metadata.

- [ ] **Step 1: Write failing tests** for due-day rollover, pending item creates exactly one new month occurrence, repeated initialization creates no duplicates, days 29–31 clamp to month end, and historical totals survive future value changes.
- [ ] **Step 2: Run tests to confirm the rollover and snapshot cases fail.**
- [ ] **Step 3: Add the timezone-aware period RPC and immutable snapshot/event rules; migrate history navigation to backend reads.**
- [ ] **Step 4: Run SQL/Node tests and verify current month and prior month in the UI.**
- [ ] **Step 5: Commit monthly records.**

### Task 6: Public aggregate share and anonymous live page

**Files:**
- Create: `supabase/migrations/0005_public_shares.sql`, `src/public-summary.js`, `test/public-summary.test.mjs`, `supabase/tests/database/public.test.sql`
- Modify: `src/main.js`, `styles.css`
- Test: `test/public-summary.test.mjs`, `supabase/tests/database/public.test.sql`

**Interfaces:**
- `getPublicSummary(slug): Promise<PublicSummary | null>` returns only approved aggregate fields through a safe database function.
- `setPublicShare(groupId, enabled, includePix): Promise<string | null>` is admin-only and creates/revokes a random slug.
- `subscribeToPublicSummary(slug, onChange): Channel` receives only aggregate broadcasts and does not subscribe to private rows.

- [ ] **Step 1: Write failing tests** asserting anonymous users cannot select private tables, public summary contains no participant identifiers, PIX is hidden by default, enabling shows only aggregate fields, and revocation immediately blocks reads/subscription.
- [ ] **Step 2: Run tests to confirm anonymous access is denied and the summary RPC is absent.**
- [ ] **Step 3: Add sanitized public-summary RPC, share toggles, aggregate-only broadcast, and `/tapago/:slug` rendering.**
- [ ] **Step 4: Run tests; use separate anonymous and member sessions to verify visibility and live update boundaries.**
- [ ] **Step 5: Commit public sharing.**

### Task 7: Replace simulated screens with responsive shared flows

**Files:**
- Create: `src/views/login.js`, `src/views/groups.js`, `src/views/group-detail.js`, `src/views/history.js`, `src/views/settings.js`
- Modify: `src/main.js`, `styles.css`, `index.html`
- Test: `test/navigation.test.mjs`, browser journeys in `test/e2e/`

**Interfaces:**
- Preserve screens for login, first access, create list, groups, fee details, history, settings, expenses, participant notice, admin review, and profile link/revoke.
- Data adapters from Tasks 3–6 supply all persisted screens; sample data is local-only test seed.

- [ ] **Step 1: Write failing navigation/role tests** for all screens, bottom navigation, admin controls, member controls, and responsive public route.
- [ ] **Step 2: Run tests to capture the missing live flows.**
- [ ] **Step 3: Replace demo login/storage actions with auth/data adapters while preserving the approved minimalist layout and colors.**
- [ ] **Step 4: Run automated journeys at mobile and desktop widths; verify no console errors and all role actions are visible/hidden correctly.**
- [ ] **Step 5: Commit the complete frontend.**

### Task 8: Local end-to-end checks, public GitHub repository, and production link

**Files:**
- Create: `test/e2e/shared-group.spec.js`, `.github/workflows/ci.yml`, `docs/OPERATIONS.md`
- Publish: only reviewed files inside this standalone `apps/tapago` repository
- Deploy: only new `/tapago/` assets after backup/hash and route verification

**Interfaces:**
- CI runs `npm ci`, `npm test`, `npm run build`, SQL policy tests, and Playwright on pull/push.
- Public repository: `https://github.com/YNSANUZ/tapago`.
- App URL: `https://saiunodf.com/tapago/`.

- [ ] **Step 1: Run full local checks with local Supabase and two independent sessions; verify every acceptance criterion in the spec.**
- [ ] **Step 2: Audit the complete repository diff and built bundle for secrets, private workspace files, NEXO data, and real personal data; resolve every finding.**
- [ ] **Step 3: Check Supabase account project quota/organization cost without changing existing projects; create/configure only the dedicated TáPago project and Google OAuth callback. If the account cannot create the project without affecting billing, keep local behavior complete and report the exact external configuration needed.**
- [ ] **Step 4: Create and push the authorized standalone public GitHub repository; verify remote URL, default branch, CI status, and public file list.**
- [ ] **Step 5: Capture production source files/route hashes and backup, deploy only `/tapago/`, then verify desktop/mobile URL, Google sign-in, RLS, public summary, Realtime, history, and that `/contas/` remains unchanged.**
- [ ] **Step 6: If any check fails, fix, redeploy the isolated app, and repeat the affected checks until successful; record exact rollback steps and final test evidence.**
- [ ] **Step 7: Commit operations and test evidence.**
