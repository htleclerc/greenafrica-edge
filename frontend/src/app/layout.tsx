import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeProvider } from '@/components/theme-provider';
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic, Space_Grotesk, Sora } from 'next/font/google';
import './globals.css';

const plex = IBM_Plex_Sans({
    subsets: ['latin', 'latin-ext'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-plex',
    display: 'swap',
});

const plexArabic = IBM_Plex_Sans_Arabic({
    subsets: ['arabic'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-plex-arabic',
    display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
    subsets: ['latin', 'latin-ext'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-space',
    display: 'swap',
});

const sora = Sora({
    subsets: ['latin', 'latin-ext'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-sora',
    display: 'swap',
});

export default async function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const locale = await getLocale();
    const messages = await getMessages();

    return (
        <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} data-theme="dark" suppressHydrationWarning>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
                {/* Favicon & PWA */}
                <link rel="icon" type="image/x-icon" href="/favicon.ico" />
                <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
                <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
                <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />
                <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
                <link rel="manifest" href="/manifest.json" />
                <meta name="theme-color" content="#10B981" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                {/* Open Graph */}
                <meta property="og:type" content="website" />
                <meta property="og:site_name" content="Green Gate" />
                <meta property="og:image" content="/og/og-image.png" />
                <meta property="og:image:width" content="1200" />
                <meta property="og:image:height" content="630" />
                {/* Twitter */}
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:image" content="/og/twitter-card.png" />
                {/* Blocking script to set theme before paint — avoids flash */}
                <script
                    dangerouslySetInnerHTML={{
                        __html: `(function(){try{var s=localStorage.getItem('africgreen_skin');s=s&&['emerald','navy','institutional'].indexOf(s)!==-1?s:'emerald';document.documentElement.setAttribute('data-skin',s);document.documentElement.setAttribute('data-theme',s==='institutional'?'light':'dark')}catch(e){}})()`,
                    }}
                />
                {/* reCAPTCHA for shipowner registration */}
                {process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY && (
                    <script
                        src={`https://www.google.com/recaptcha/api.js?render=${process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}`}
                        async
                        defer
                    />
                )}
            </head>
            <body className={`antialiased font-sans ${plex.variable} ${plexArabic.variable} ${spaceGrotesk.variable} ${sora.variable}`} suppressHydrationWarning>
                <NextIntlClientProvider locale={locale} messages={messages}>
                    <ThemeProvider
                        attribute="data-theme"
                        defaultTheme="dark"
                        enableSystem={false}
                        storageKey="theme"
                        disableTransitionOnChange
                    >
                        {children}
                    </ThemeProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
