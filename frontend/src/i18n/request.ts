import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

const SUPPORTED_LOCALES = ['en', 'fr', 'pt', 'sw'] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupported(locale: string): locale is SupportedLocale {
    return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

export default getRequestConfig(async () => {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
    const locale: SupportedLocale = cookieLocale && isSupported(cookieLocale) ? cookieLocale : 'en';

    return {
        locale,
        messages: (await import(`../../messages/${locale}.json`)).default,
    };
});
