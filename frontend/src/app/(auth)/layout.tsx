import * as React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Secure Access | Africgreen',
    description: 'Sovereign Access Portal — Authorized personnel only.',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <div
            className="min-h-screen flex flex-col"
            style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text-primary)' }}
        >
            {children}
        </div>
    );
}
