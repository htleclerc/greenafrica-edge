import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

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
                <link rel="manifest" href="/manifest.json" />
                <meta name="theme-color" content="#10B981" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                {/* Blocking script to set theme before paint — avoids flash */}
                <script
                    dangerouslySetInnerHTML={{
                        __html: `(function(){try{var s=localStorage.getItem('africgreen_skin');s=s&&['emerald','navy','institutional'].indexOf(s)!==-1?s:'emerald';document.documentElement.setAttribute('data-skin',s);document.documentElement.setAttribute('data-theme',s==='institutional'?'light':'dark')}catch(e){}})()`,
                    }}
                />
            </head>
            <body className="antialiased font-sans">
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
