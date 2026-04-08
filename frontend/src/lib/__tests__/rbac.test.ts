import { describe, it, expect } from 'vitest';
import { canAccess, filterNavItems } from '../rbac';
import { UserRole } from '@/types/secure';

// ── canAccess ────────────────────────────────────────────────────────────────

describe('canAccess', () => {
  // Pages accessible to ALL roles
  const universalPages = ['map', 'vessels', 'invoices', 'settings'];
  const allRoles = Object.values(UserRole);

  universalPages.forEach((page) => {
    it(`allows ALL roles to access "${page}"`, () => {
      allRoles.forEach((role) => {
        expect(canAccess(page, role)).toBe(true);
      });
    });
  });

  // Unknown nav keys default to allow
  it('allows access to unknown nav keys', () => {
    expect(canAccess('nonexistent-page', UserRole.PORT_OFFICER)).toBe(true);
    expect(canAccess('unknown', UserRole.SHIPPING_AGENT)).toBe(true);
  });

  // ── Port-only pages ─────────────────────────────────────────────────────
  describe('port-authority restricted pages', () => {
    it('grants PORT_OFFICER access to green-ledger', () => {
      expect(canAccess('green-ledger', UserRole.PORT_OFFICER)).toBe(true);
    });

    it('denies SHIPPING_AGENT access to green-ledger', () => {
      expect(canAccess('green-ledger', UserRole.SHIPPING_AGENT)).toBe(false);
    });

    it('denies FLEET_MANAGER access to green-ledger', () => {
      expect(canAccess('green-ledger', UserRole.FLEET_MANAGER)).toBe(false);
    });

    it('grants COMPLIANCE_AUDITOR access to green-ledger', () => {
      expect(canAccess('green-ledger', UserRole.COMPLIANCE_AUDITOR)).toBe(true);
    });
  });

  // ── Admin pages ─────────────────────────────────────────────────────────
  describe('admin pages', () => {
    it('grants FINANCE_ADMIN access to tax-settings', () => {
      expect(canAccess('tax-settings', UserRole.FINANCE_ADMIN)).toBe(true);
    });

    it('denies PORT_OFFICER access to tax-settings', () => {
      expect(canAccess('tax-settings', UserRole.PORT_OFFICER)).toBe(false);
    });

    it('grants FINANCE_ADMIN access to revenue', () => {
      expect(canAccess('revenue', UserRole.FINANCE_ADMIN)).toBe(true);
    });

    it('denies SHIPPING_AGENT access to revenue', () => {
      expect(canAccess('revenue', UserRole.SHIPPING_AGENT)).toBe(false);
    });

    it('grants SUPERADMIN access to all admin pages', () => {
      expect(canAccess('tax-settings', UserRole.SUPERADMIN)).toBe(true);
      expect(canAccess('revenue', UserRole.SUPERADMIN)).toBe(true);
      expect(canAccess('validations', UserRole.SUPERADMIN)).toBe(true);
    });
  });

  // ── Shipping pages ──────────────────────────────────────────────────────
  describe('shipping pages', () => {
    it('grants FLEET_MANAGER access to my-fleet', () => {
      expect(canAccess('my-fleet', UserRole.FLEET_MANAGER)).toBe(true);
    });

    it('grants SHIPPING_AGENT access to my-fleet', () => {
      expect(canAccess('my-fleet', UserRole.SHIPPING_AGENT)).toBe(true);
    });

    it('denies PORT_OFFICER access to my-fleet', () => {
      expect(canAccess('my-fleet', UserRole.PORT_OFFICER)).toBe(false);
    });

    it('denies FINANCE_ADMIN access to my-fleet', () => {
      expect(canAccess('my-fleet', UserRole.FINANCE_ADMIN)).toBe(false);
    });
  });

  // ── Disputes ────────────────────────────────────────────────────────────
  describe('disputes', () => {
    it('grants LEGAL_REP access to disputes', () => {
      expect(canAccess('disputes', UserRole.LEGAL_REP)).toBe(true);
    });

    it('denies FLEET_MANAGER access to disputes', () => {
      expect(canAccess('disputes', UserRole.FLEET_MANAGER)).toBe(false);
    });

    it('denies FINANCE_CONTACT access to disputes', () => {
      expect(canAccess('disputes', UserRole.FINANCE_CONTACT)).toBe(false);
    });
  });

  // ── Audit trail ──────────────────────────────────────────────────────────
  describe('audit', () => {
    it('grants PORT_OFFICER access to audit', () => {
      expect(canAccess('audit', UserRole.PORT_OFFICER)).toBe(true);
    });

    it('grants COMPLIANCE_AUDITOR access to audit', () => {
      expect(canAccess('audit', UserRole.COMPLIANCE_AUDITOR)).toBe(true);
    });

    it('denies SHIPPING_AGENT access to audit', () => {
      expect(canAccess('audit', UserRole.SHIPPING_AGENT)).toBe(false);
    });

    it('denies FINANCE_ADMIN access to audit', () => {
      expect(canAccess('audit', UserRole.FINANCE_ADMIN)).toBe(false);
    });
  });

  // ── SUPERADMIN has access to everything ─────────────────────────────────
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

// ── filterNavItems ───────────────────────────────────────────────────────────

describe('filterNavItems', () => {
  const allItems = [
    { key: 'map', label: 'Map' },
    { key: 'my-fleet', label: 'My Fleet' },
    { key: 'tax-settings', label: 'Tax Settings' },
    { key: 'green-ledger', label: 'Green Ledger' },
    { key: 'settings', label: 'Settings' },
  ];

  it('filters items for SHIPPING_AGENT (no admin pages)', () => {
    const result = filterNavItems(allItems, UserRole.SHIPPING_AGENT);
    const keys = result.map((item) => item.key);

    expect(keys).toContain('map');
    expect(keys).toContain('my-fleet');
    expect(keys).toContain('settings');
    expect(keys).not.toContain('tax-settings');
    expect(keys).not.toContain('green-ledger');
  });

  it('filters items for FINANCE_ADMIN', () => {
    const result = filterNavItems(allItems, UserRole.FINANCE_ADMIN);
    const keys = result.map((item) => item.key);

    expect(keys).toContain('map');
    expect(keys).toContain('tax-settings');
    expect(keys).toContain('settings');
    expect(keys).not.toContain('my-fleet');
    expect(keys).not.toContain('green-ledger');
  });

  it('returns all items for SUPERADMIN', () => {
    const result = filterNavItems(allItems, UserRole.SUPERADMIN);
    expect(result).toHaveLength(allItems.length);
  });

  it('preserves original item shape', () => {
    const items = [{ key: 'map', label: 'Dashboard', icon: 'globe' }];
    const result = filterNavItems(items, UserRole.PORT_OFFICER);
    expect(result[0]).toEqual({ key: 'map', label: 'Dashboard', icon: 'globe' });
  });
});
