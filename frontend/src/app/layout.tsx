import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeProvider } from '@/components/theme-provider';
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
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

// Les montants, références de facture, IMO et libellés techniques en capitales sont
// rendus en monospace : ce n'est pas décoratif, ça aligne les colonnes de chiffres et
// rend deux IMO comparables à l'œil.
const plexMono = IBM_Plex_Mono({
    subsets: ['latin', 'latin-ext'],
    weight: ['400', '500', '600'],
    variable: '--font-plex-mono',
    display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
    subsets: ['latin', 'latin-ext'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-space',
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
                        __html: `(function(){try{var d=document.documentElement,S='africgreen_skin',P='africgreen_theme_pref';var s=localStorage.getItem(S),p=localStorage.getItem(P);if(s==='institutional'){s='emerald';localStorage.setItem(S,s);if(p!=='dark'&&p!=='light'){p='light';localStorage.setItem(P,p)}}s=(s==='emerald'||s==='navy')?s:'emerald';d.setAttribute('data-skin',s);var t=(p==='dark'||p==='light')?p:'dark';d.setAttribute('data-theme',t);localStorage.setItem('theme',t)}catch(e){}})()`,
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
            <body className={`antialiased font-sans ${plex.variable} ${plexArabic.variable} ${plexMono.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
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
