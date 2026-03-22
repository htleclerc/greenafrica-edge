import * as React from 'react';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
    return (
        <div
            className="min-h-screen flex flex-col"
            style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text-primary)' }}
        >
            {children}
        </div>
    );
}
