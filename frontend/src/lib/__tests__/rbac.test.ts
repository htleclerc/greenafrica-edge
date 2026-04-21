import { describe, it, expect } from 'vitest';
import { canAccess, canEdit, filterNavItems, MONEY_RAIL_KEYS } from '../rbac';
import { UserRole } from '@/types/secure';

const ALL_ROLES = [
  UserRole.PORT_OFFICER,
  UserRole.FINANCE_ADMIN,
  UserRole.SHIPPING_AGENT,
  UserRole.SUPERADMIN,
  UserRole.MANAGER,
] as const;

describe('canAccess', () => {
  const universalPages = ['map', 'vessels', 'invoices', 'settings', 'disputes'];

  universalPages.forEach((page) => {
    it(`allows core roles to access "${page}"`, () => {
      ALL_ROLES.forEach((role) => {
        expect(canAccess(page, role)).toBe(true);
      });
    });
  });

  // ── Deny-by-default for unknown nav keys (was fail-open before PR-1) ──
  describe('unknown nav key — deny-by-default', () => {
    it('denies PORT_OFFICER on unknown key', () => {
      expect(canAccess('nonexistent-page', UserRole.PORT_OFFICER)).toBe(false);
    });
    it('denies FINANCE_ADMIN on unknown key', () => {
      expect(canAccess('nonexistent-page', UserRole.FINANCE_ADMIN)).toBe(false);
    });
    it('denies SHIPPING_AGENT on unknown key', () => {
      expect(canAccess('nonexistent-page', UserRole.SHIPPING_AGENT)).toBe(false);
    });
    it('denies MANAGER on unknown key', () => {
      expect(canAccess('nonexistent-page', UserRole.MANAGER)).toBe(false);
    });
    it('allows SUPERADMIN on unknown key (escape hatch for fast iteration)', () => {
      expect(canAccess('nonexistent-page', UserRole.SUPERADMIN)).toBe(true);
    });
  });

  describe('port-authority restricted pages', () => {
    it('grants PORT_OFFICER access to green-ledger', () => {
      expect(canAccess('green-ledger', UserRole.PORT_OFFICER)).toBe(true);
    });
    it('denies SHIPPING_AGENT access to green-ledger', () => {
      expect(canAccess('green-ledger', UserRole.SHIPPING_AGENT)).toBe(false);
    });
    it('denies FINANCE_ADMIN access to green-ledger', () => {
      expect(canAccess('green-ledger', UserRole.FINANCE_ADMIN)).toBe(false);
    });
    it('denies MANAGER access to green-ledger', () => {
      expect(canAccess('green-ledger', UserRole.MANAGER)).toBe(false);
    });
  });

  describe('admin pages', () => {
    it('grants FINANCE_ADMIN access to tax-settings', () => {
      expect(canAccess('tax-settings', UserRole.FINANCE_ADMIN)).toBe(true);
    });
    it('grants PORT_OFFICER read access to tax-settings', () => {
      expect(canAccess('tax-settings', UserRole.PORT_OFFICER)).toBe(true);
    });
    it('denies SHIPPING_AGENT access to revenue', () => {
      expect(canAccess('revenue', UserRole.SHIPPING_AGENT)).toBe(false);
    });
    it('denies SHIPPING_AGENT access to payments', () => {
      expect(canAccess('payments', UserRole.SHIPPING_AGENT)).toBe(false);
    });
    it('grants FINANCE_ADMIN access to payments', () => {
      expect(canAccess('payments', UserRole.FINANCE_ADMIN)).toBe(true);
    });
    it('grants SUPERADMIN access to all admin pages', () => {
      expect(canAccess('tax-settings', UserRole.SUPERADMIN)).toBe(true);
      expect(canAccess('revenue', UserRole.SUPERADMIN)).toBe(true);
      expect(canAccess('payments', UserRole.SUPERADMIN)).toBe(true);
      expect(canAccess('validations', UserRole.SUPERADMIN)).toBe(true);
    });
  });

  describe('shipping pages', () => {
    it('grants SHIPPING_AGENT access to my-fleet', () => {
      expect(canAccess('my-fleet', UserRole.SHIPPING_AGENT)).toBe(true);
    });
    it('denies PORT_OFFICER access to my-fleet', () => {
      expect(canAccess('my-fleet', UserRole.PORT_OFFICER)).toBe(false);
    });
    it('denies FINANCE_ADMIN access to my-fleet', () => {
      expect(canAccess('my-fleet', UserRole.FINANCE_ADMIN)).toBe(false);
    });
    it('denies MANAGER access to my-fleet', () => {
      expect(canAccess('my-fleet', UserRole.MANAGER)).toBe(false);
    });
  });

  describe('audit', () => {
    it('grants PORT_OFFICER access to audit', () => {
      expect(canAccess('audit', UserRole.PORT_OFFICER)).toBe(true);
    });
    it('grants SUPERADMIN access to audit', () => {
      expect(canAccess('audit', UserRole.SUPERADMIN)).toBe(true);
    });
    it('grants MANAGER access to audit (read-only)', () => {
      expect(canAccess('audit', UserRole.MANAGER)).toBe(true);
      expect(canEdit('audit', UserRole.MANAGER)).toBe(false);
    });
    it('denies SHIPPING_AGENT access to audit', () => {
      expect(canAccess('audit', UserRole.SHIPPING_AGENT)).toBe(false);
    });
    it('denies FINANCE_ADMIN access to audit', () => {
      expect(canAccess('audit', UserRole.FINANCE_ADMIN)).toBe(false);
    });
  });

  // ── MANAGER role — the new role from PR-1 ──
  describe('MANAGER role — ops access', () => {
    const allowedOpsKeys = [
      'map', 'simulator', 'vessels', 'invoices', 'disputes', 'tco',
      'alerts', 'inspector', 'audit', 'validations', 'settings',
    ];
    allowedOpsKeys.forEach((key) => {
      it(`grants MANAGER access to ops key "${key}"`, () => {
        expect(canAccess(key, UserRole.MANAGER)).toBe(true);
      });
    });
  });

  describe('MANAGER role — money-rail denials (no money, no RBAC)', () => {
    const moneyRail = ['tax-settings', 'revenue', 'payments'];
    moneyRail.forEach((key) => {
      it(`denies MANAGER access to money-rail key "${key}"`, () => {
        expect(canAccess(key, UserRole.MANAGER)).toBe(false);
      });
    });

    it('denies MANAGER access to my-fleet (shipping-only)', () => {
      expect(canAccess('my-fleet', UserRole.MANAGER)).toBe(false);
    });

    it('denies MANAGER access to green-ledger (analyst-only)', () => {
      expect(canAccess('green-ledger', UserRole.MANAGER)).toBe(false);
    });
  });

  describe('SUPERADMIN access', () => {
    const allPages = [
      'map', 'simulator', 'vessels', 'invoices', 'disputes',
      'my-fleet', 'tco', 'green-ledger', 'alerts', 'inspector',
      'analytics', 'validations', 'tax-settings', 'revenue', 'settings', 'audit',
    ];
    allPages.forEach((page) => {
      it(`grants SUPERADMIN access to "${page}"`, () => {
        expect(canAccess(page, UserRole.SUPERADMIN)).toBe(true);
      });
    });
  });
});

describe('canEdit (read vs write distinction)', () => {
  it('grants FINANCE_ADMIN edit on tax-settings', () => {
    expect(canEdit('tax-settings', UserRole.FINANCE_ADMIN)).toBe(true);
  });

  it('grants SUPERADMIN edit on tax-settings', () => {
    expect(canEdit('tax-settings', UserRole.SUPERADMIN)).toBe(true);
  });

  it('denies PORT_OFFICER edit on tax-settings (read-only)', () => {
    expect(canAccess('tax-settings', UserRole.PORT_OFFICER)).toBe(true);
    expect(canEdit('tax-settings', UserRole.PORT_OFFICER)).toBe(false);
  });

  it('denies SHIPPING_AGENT edit on tax-settings (no access at all)', () => {
    expect(canEdit('tax-settings', UserRole.SHIPPING_AGENT)).toBe(false);
  });

  it('grants edit on a page with no read-only roles configured', () => {
    expect(canEdit('invoices', UserRole.SHIPPING_AGENT)).toBe(true);
    expect(canEdit('invoices', UserRole.PORT_OFFICER)).toBe(true);
  });

  it('denies edit on a page the user has no access to', () => {
    expect(canAccess('revenue', UserRole.SHIPPING_AGENT)).toBe(false);
    expect(canEdit('revenue', UserRole.SHIPPING_AGENT)).toBe(false);
  });

  // ── MANAGER read-only on sensitive pages ──
  it('denies MANAGER edit on invoices (read-only)', () => {
    expect(canAccess('invoices', UserRole.MANAGER)).toBe(true);
    expect(canEdit('invoices', UserRole.MANAGER)).toBe(false);
  });

  it('denies MANAGER edit on disputes (read-only — resolve = money action)', () => {
    expect(canAccess('disputes', UserRole.MANAGER)).toBe(true);
    expect(canEdit('disputes', UserRole.MANAGER)).toBe(false);
  });

  it('denies MANAGER edit on audit (read-only)', () => {
    expect(canAccess('audit', UserRole.MANAGER)).toBe(true);
    expect(canEdit('audit', UserRole.MANAGER)).toBe(false);
  });

  it('grants MANAGER edit on validations (ops write)', () => {
    expect(canAccess('validations', UserRole.MANAGER)).toBe(true);
    expect(canEdit('validations', UserRole.MANAGER)).toBe(true);
  });
});

describe('MONEY_RAIL_KEYS export', () => {
  it('exposes the canonical money-rail keys for server-side guards', () => {
    expect(MONEY_RAIL_KEYS.has('tax-settings')).toBe(true);
    expect(MONEY_RAIL_KEYS.has('revenue')).toBe(true);
    expect(MONEY_RAIL_KEYS.has('payments')).toBe(true);
  });

  it('does NOT include ops keys', () => {
    expect(MONEY_RAIL_KEYS.has('vessels')).toBe(false);
    expect(MONEY_RAIL_KEYS.has('alerts')).toBe(false);
    expect(MONEY_RAIL_KEYS.has('audit')).toBe(false);
  });
});

describe('filterNavItems', () => {
  const allItems = [
    { key: 'map', label: 'Map' },
    { key: 'my-fleet', label: 'My Fleet' },
    { key: 'tax-settings', label: 'Tax Settings' },
    { key: 'green-ledger', label: 'Green Ledger' },
    { key: 'settings', label: 'Settings' },
  ];

  it('filters items for SHIPPING_AGENT', () => {
    const result = filterNavItems(allItems, UserRole.SHIPPING_AGENT);
    const keys = result.map((item) => item.key);
    expect(keys).toContain('map');
    expect(keys).toContain('my-fleet');
    expect(keys).toContain('settings');
    expect(keys).not.toContain('tax-settings');
    expect(keys).not.toContain('green-ledger');
  });

  it('returns all items for SUPERADMIN', () => {
    const result = filterNavItems(allItems, UserRole.SUPERADMIN);
    expect(result).toHaveLength(allItems.length);
  });

  it('filters out money-rail and shipping-only items for MANAGER', () => {
    const result = filterNavItems(allItems, UserRole.MANAGER);
    const keys = result.map((item) => item.key);
    expect(keys).toContain('map');
    expect(keys).toContain('settings');
    expect(keys).not.toContain('tax-settings');
    expect(keys).not.toContain('my-fleet');
    expect(keys).not.toContain('green-ledger');
  });
});
