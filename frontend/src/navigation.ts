export const locales = ['en', 'fr', 'pt', 'sw', 'ar'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
