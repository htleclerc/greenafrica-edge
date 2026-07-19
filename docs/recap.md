# Green-Gate Project Recap

## [2026-03-02 15:30] Initial Project Request
- **Platform Name**: Green-Gate
- **Objective**: Carbon tax calculation for the government (simulation, information, real fee payment).
- **Frontend Stack**: React (Next.js)
- **Backend Stack**: Go, Supabase (PostgreSQL)
- **Key Features**:
  - Information portal
  - Simulation tool for fees
  - User login & payment of real fees
- **Core Requirements**:
  - DDD Architecture
  - Internationalization (i18n)
  - Mobile-first & PWA (offline)
  - ThemeProvider for unified styling
  - Enums/Constants for statuses and actions
  - No hardcoded data in views

## [2026-03-04 19:02] AI-Driven Multi-Country Protocol Analysis
- **Objective**: Analyze the feasibility of a pan-African protocol utilizing AI and AIS data.
- **Key Features**:
  1. AI to track and analyze vessel movements in databases.
  2. Cartography of tax collection estimates by coastal country.
  3. Protocol for identifying vessels and enforcing tax payments to respective countries.

## [2026-06-12 00:10] Video Demo Preparation & QA Setup
- **Objective**: Prepare for a video demonstration of the sovereign climate governance platform (Green-Gate).
- **Actions & Diagnostics**:
  1. Built the Next.js workspace successfully to verify compile.
  2. Booted the local Next.js dev server on port 3300.
  3. Fixed the `fakeImo` E2E helper logic so it correctly generates valid 7-digit IMO numbers instead of 6 digits, fixing browser validation blocks.
  4. Added metadata titles to `frontend/src/app/page.tsx` so the root page has a valid title, resolving the smoke E2E test failure.
  5. Added missing `NEXT_PUBLIC_BASE_URL` in `.env.local` to fix redirect links for Supabase invite emails.
  6. Diagnosed rate limit constraints on hosted Supabase Auth (429 email rate limits) preventing E2E signup completions in dev environment.
  7. Started building a comprehensive QA/Walkthrough script and workflow plan for the video demo.

## [2026-06-12 01:00] E2E Race Condition Fixes & Unit Test Stability
- **Objective**: Stabilize E2E and unit test suites for demo-ready confidence.
- **Actions & Diagnostics**:
  1. Resolved E2E race condition in `02-wire-payment.spec.ts` by changing the polling logic to wait for both the payment confirmation and the creation of the database notification row, preventing early test exits and cascading database foreign key constraint violations.
  2. Restored unit test execution by removing leftover database debug lines in `confirmPayment.ts` and `notificationService.ts` that were calling uncached service role clients and crashed on missing Supabase credentials in the test runner.
  3. Replaced `@e2e.test` domains with standard TLD `@e2e-test.com` to prevent Supabase GoTrue invite failures.
  4. Verified next build (82 pages successfully optimized) and full unit test execution (all 727 tests passing).

## [2026-06-12 02:45] Clean Slate Reversion & QA Verification
- **Objective**: Execute the QA screenshots spec and revert the database state to ensure a clean slate for the user's video demo recording.
- **Actions & Diagnostics**:
  1. Ran the E2E screenshots spec `04-demo-screenshots.spec.ts` which successfully went through all 5 demo scenes and captured updated crisp screenshots.
  2. Copied the generated screenshots to the brain's artifacts directory so they render in `walkthrough.md`.
  3. Cleaned up the generated payments with bank references containing `SWIFT` that were created during the test runs.
  4. Reverted the corresponding transactions (`81be7109-0cca-4dc8-a077-eda4f4011570` and `65e28ceb-c793-49da-9604-05b0d2f421a3`) to `PENDING` / `CURRENT` statuses and their respective vessels back to `APPROACHING` compliance status in the database.
  5. Resolved database constraints/invariant triggers requiring `status` and `collections_status` to stay in sync during reversion.
  6. Confirmed unit tests pass with a clean run of 727/727 tests passing.

## [2026-06-12 03:00] Automated Video Demo Generation
- **Objective**: Automate and capture the full humanized video demo for the user.
- **Actions & Diagnostics**:
  1. Created a dedicated E2E script [05-video-generation.spec.ts](file:///c:/Users/lecle/Workspace/africgreen/frontend/e2e/scenarios/05-video-generation.spec.ts) with human-like parameters: slow typing delays, smooth ease-in-out cursor animations (visualized with an injected green cursor pointer), and page transition pauses.
  2. Booted and verified the local Next.js dev server on port 3300.
  3. Enabled Playwright video capture (`video: 'on'`) and increased test timeouts to `240_000ms` to avoid early timeouts during slow humanized interactions.
  4. Executed the spec successfully in 1.6 minutes, recording a complete walkthrough of the 5 demo scenes.
  5. Saved and copied the recorded `video_demo.webm` to the brain's artifacts directory and embedded it directly inside `walkthrough.md`.
  6. Re-ran the database cleanup script to delete the newly generated payments and reset the transaction/vessel compliance statuses back to their clean states for the user.
  7. Restored the Playwright video config back to `video: 'retain-on-failure'`.

## [2026-06-12 18:15] Branch Restructuring & Demo Backdoor Restoration
- **Objective**: Divide workspace into secure production/staging branches (`main`, `develop`) and a dedicated presentation branch (`demo`) with restored backdoor authentication.
- **Actions & Diagnostics**:
  1. Staged and committed uncommitted E2E/testing enhancements to the feature branch.
  2. Merged the feature branch into `develop` and fast-forwarded `main` to align them with the production-ready code.
  3. Reset the `demo` branch to the latest `develop` state and re-implemented the demo bypasses.
  4. Configured `middleware.ts`, `RoleContext.tsx`, `requireOwner.ts`, and `requireRole.ts` to accept the `demo_active` cookie and mock roles.
  5. Wrapped server-side cookie checks in `try/catch` blocks to protect Vitest runs from crashing due to dynamic Next.js headers outside request contexts.
  6. Restored the "Quick Demo Access" UI on the login page unconditionally for the `demo` branch.
  7. Built the workspace successfully and booted the Next.js server on port 3300. All 742 unit tests passed.

