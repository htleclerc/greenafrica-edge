import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { locales, type Locale, defaultLocale } from '@/navigation';

function isSupported(locale: string): locale is Locale {
    return (locales as readonly string[]).includes(locale);
}

export default getRequestConfig(async () => {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
    const locale: Locale = cookieLocale && isSupported(cookieLocale) ? cookieLocale : defaultLocale;

    return {
        locale,
        messages: (await import(`../../messages/${locale}.json`)).default,
    };
});
