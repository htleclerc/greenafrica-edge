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
                {/* Blocking script to set theme before paint — avoids flash */}
                <script
                    dangerouslySetInnerHTML={{
                        __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}else{document.documentElement.setAttribute('data-theme','dark')}var s=localStorage.getItem('africgreen_skin');document.documentElement.setAttribute('data-skin',s&&['emerald','navy','institutional'].indexOf(s)!==-1?s:'emerald')}catch(e){}})()`,
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
