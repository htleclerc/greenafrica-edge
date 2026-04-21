'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

/**
 * OsTabs — thin wrapper around @radix-ui/react-tabs applying the V1 theme.
 *
 * Anatomy:
 *   <OsTabs defaultValue="payments">
 *     <OsTabsList>
 *       <OsTabsTrigger value="emissions">Émissions</OsTabsTrigger>
 *       <OsTabsTrigger value="payments">Paiements</OsTabsTrigger>
 *     </OsTabsList>
 *     <OsTabsContent value="emissions">…</OsTabsContent>
 *     <OsTabsContent value="payments">…</OsTabsContent>
 *   </OsTabs>
 *
 * Radix gives a11y for free: role="tablist" / role="tab" / role="tabpanel",
 * arrow-key navigation, focus management, keyboard activation (Enter/Space).
 */

export const OsTabs = TabsPrimitive.Root;

export const OsTabsList = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.List>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className = '', ...props }, ref) => (
    <TabsPrimitive.List
        ref={ref}
        className={`
            flex items-center gap-1 border-b border-[var(--os-border)]
            ${className}
        `}
        {...props}
    />
));
OsTabsList.displayName = 'OsTabsList';

export const OsTabsTrigger = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className = '', ...props }, ref) => (
    <TabsPrimitive.Trigger
        ref={ref}
        className={`
            relative px-3 py-2 text-xs font-semibold uppercase tracking-widest
            text-[var(--os-text-muted)]
            transition-colors duration-150
            hover:text-[var(--os-text-primary)]
            focus-visible:outline-none focus-visible:text-[var(--os-text-primary)]
            data-[state=active]:text-[var(--os-text-primary)]
            data-[state=active]:after:absolute
            data-[state=active]:after:left-0
            data-[state=active]:after:right-0
            data-[state=active]:after:-bottom-px
            data-[state=active]:after:h-0.5
            data-[state=active]:after:bg-[var(--os-brand-green)]
            ${className}
        `}
        {...props}
    />
));
OsTabsTrigger.displayName = 'OsTabsTrigger';

export const OsTabsContent = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className = '', ...props }, ref) => (
    <TabsPrimitive.Content
        ref={ref}
        className={`
            pt-4 focus-visible:outline-none
            data-[state=inactive]:hidden
            ${className}
        `}
        {...props}
    />
));
OsTabsContent.displayName = 'OsTabsContent';
