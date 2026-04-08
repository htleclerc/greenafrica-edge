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
## Branch Management
- **`main` / `develop`**: Strict security. Authentication required via Supabase.
- **`demo`**: Sandbox branch. Includes authentication bypass for presentations. Never merge `demo` back to `develop` or `main`.
