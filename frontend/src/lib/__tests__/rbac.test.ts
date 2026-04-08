import { describe, it, expect } from 'vitest';
import { canAccess, filterNavItems } from '../rbac';
import { UserRole } from '@/types/secure';

describe('canAccess', () => {
  const universalPages = ['map', 'vessels', 'invoices', 'settings', 'disputes'];

  universalPages.forEach((page) => {
    it(`allows core roles to access "${page}"`, () => {
      [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SHIPPING_AGENT, UserRole.SUPERADMIN].forEach((role) => {
        expect(canAccess(page, role)).toBe(true);
      });
    });
  });

  it('allows access to unknown nav keys', () => {
    expect(canAccess('nonexistent-page', UserRole.PORT_OFFICER)).toBe(true);
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
  });

  describe('admin pages', () => {
    it('grants FINANCE_ADMIN access to tax-settings', () => {
      expect(canAccess('tax-settings', UserRole.FINANCE_ADMIN)).toBe(true);
    });
    it('denies PORT_OFFICER access to tax-settings', () => {
      expect(canAccess('tax-settings', UserRole.PORT_OFFICER)).toBe(false);
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
  });

  describe('audit', () => {
    it('grants PORT_OFFICER access to audit', () => {
      expect(canAccess('audit', UserRole.PORT_OFFICER)).toBe(true);
    });
    it('grants SUPERADMIN access to audit', () => {
      expect(canAccess('audit', UserRole.SUPERADMIN)).toBe(true);
    });
    it('denies SHIPPING_AGENT access to audit', () => {
      expect(canAccess('audit', UserRole.SHIPPING_AGENT)).toBe(false);
    });
    it('denies FINANCE_ADMIN access to audit', () => {
      expect(canAccess('audit', UserRole.FINANCE_ADMIN)).toBe(false);
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
});
