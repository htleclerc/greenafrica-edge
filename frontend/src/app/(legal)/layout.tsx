import * as React from 'react';
import type { Metadata } from 'next';
import { Navbar } from '@/components/layout/Navbar';

export const metadata: Metadata = {
    title: 'Legal | Africgreen',
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
    return (
        <div
            className="min-h-screen flex flex-col"
            style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text-primary)' }}
        >
            <Navbar />
            {children}
        </div>
    );
}
