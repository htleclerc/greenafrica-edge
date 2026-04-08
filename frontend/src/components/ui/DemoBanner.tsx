'use client';

import * as React from 'react';
import { AlertTriangle, X, ShieldAlert, Cpu } from 'lucide-react';

export function DemoBanner() {
    const [visible, setVisible] = React.useState(true);

    if (!visible) return null;

    function clearDemo() {
        // Clear both cookie and localStorage
        document.cookie = 'demo_active=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        document.cookie = 'demo_role=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        localStorage.removeItem('demo_active');
        localStorage.removeItem('demo_role');
        window.location.href = '/login';
    }

    return (
        <div className="fixed top-0 left-0 right-0 z-[60] animate-in slide-in-from-top duration-500">
            <div 
                className="h-10 px-4 flex items-center justify-between border-b backdrop-blur-md"
                style={{ 
                    background: 'linear-gradient(90deg, rgba(234,179,8,0.15) 0%, rgba(234,179,8,0.05) 100%)',
                    borderColor: 'rgba(234,179,8,0.3)',
                    color: 'var(--os-yellow)'
                }}
            >
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-5 h-5 rounded bg-yellow-500/20">
                        <ShieldAlert className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                            Environnement de Démonstration
                        </span>
                        <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-current opacity-30" />
                        <span className="hidden sm:inline-block text-[11px] font-medium opacity-90">
                            Authentification bypassée • Données fictives
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={clearDemo}
                        className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 transition-all group"
                    >
                        <Cpu className="w-3 h-3 group-hover:rotate-12 transition-transform" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Quitter la démo</span>
                    </button>
                    <button 
                        onClick={() => setVisible(false)}
                        className="p-1 hover:bg-black/10 rounded transition-colors"
                    >
                        <X className="w-4 h-4 opacity-50" />
                    </button>
                </div>
            </div>
            
            {/* Ambient glow */}
            <div className="absolute inset-0 pointer-events-none shadow-[0_4px_20px_rgba(234,179,8,0.1)]" />
        </div>
    );
}
