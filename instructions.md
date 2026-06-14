# Project Instructions: AfricGreen

## Core Principles
1. **Internationalization (i18n)**: All texts MUST be localized. No hardcoded strings in views.
2. **Domain-Driven Design (DDD)**: Maintain clear separation between Domain, Application, Infrastructure, and Interfaces.
3. **Mobile First**: Design for mobile first, then scale up. PWA required with offline support.
4. **No Hardcoded Data**: Use mocks in `mock/datas` or local storage providers.
5. **Enums & Constants**: Use codes for comparisons (e.g., statuses, actions) and labels for display.
6. **Unified Styling**: Use `ThemeProvider`. No ad-hoc colors.
7. **Clean Code**: English for all coding elements (variables, functions, files, etc.).

## Tech Stack
- **Frontend**: Next.js, React, Tailwind CSS (if requested, otherwise Vanilla CSS). (User requested Next.js/React).
- **Backend**: Go (Golang).
- **Database**: PostgreSQL (via Supabase).
- **Auth/Storage**: Supabase.

## Documentation
- Keep `recap.md` updated with prompt summaries every 6 hours.
- Update `instructions.md` with new business rules as they emerge.
- Refer to `docs/video_demo_qa_plan.md` for the step-by-step video recording script and QA walkthrough.

## Video Demo & Testing Notes
- **Local Dev Server**: Always runs on `http://localhost:3300` (port 3300).
- **Environment**: E2E tests and signup flows require `NEXT_PUBLIC_BASE_URL` to be populated in `frontend/.env.local`.
- **Auth Constraints**: Hosted Supabase Auth rate limits may restrict email invitation requests. Furthermore, Supabase GoTrue invite verification requires email addresses to have standard, valid TLDs (e.g. `@e2e-test.com` instead of `@e2e.test`). For demonstrations and QA walk-throughs, use pre-seeded test accounts (`sadmin@greengate.africa`, `armateur@greengate.africa`, `superadmin@africgreen.gov.sl`).

## Branch Structure & Demo Environment
- **`main`**: Production branch. Must remain fully secured.
- **`develop`**: Development and staging branch. Must remain fully secured.
- **`demo`**: Presentation/demo branch. Features the demo backdoor (`demo_active` cookie and `Quick Demo Access` login panel) for sandbox presentations and local QA walk-throughs.
