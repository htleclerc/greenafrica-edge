export const locales = ['en', 'fr', 'pt', 'sw', 'ar', 'so'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
