import { describe, it, expect } from 'vitest';
import { ROLE_MAP } from './route';

describe('ROLE_MAP — signup form role → DB role', () => {
  it('maps Port Authority roles correctly', () => {
    expect(ROLE_MAP.PORT_OFFICER).toBe('PORT_OFFICER');
    expect(ROLE_MAP.FINANCE_ADMIN).toBe('FINANCE_ADMIN');
    expect(ROLE_MAP.COMPLIANCE_AUDITOR).toBe('PORT_OFFICER');
    expect(ROLE_MAP.OPERATIONS_MANAGER).toBe('MANAGER');
  });

  it('maps Shipping Agent roles to SHIPPING_AGENT', () => {
    expect(ROLE_MAP.SHIPPING_AGENT).toBe('SHIPPING_AGENT');
    expect(ROLE_MAP.FLEET_MANAGER).toBe('SHIPPING_AGENT');
    expect(ROLE_MAP.FINANCE_CONTACT).toBe('SHIPPING_AGENT');
    expect(ROLE_MAP.LEGAL_REP).toBe('SHIPPING_AGENT');
  });

  it('only produces the 4 valid assignable DB role values (SUPERADMIN excluded — manual elevation only)', () => {
    const validDbRoles = new Set(['PORT_OFFICER', 'FINANCE_ADMIN', 'SHIPPING_AGENT', 'MANAGER']);
    Object.values(ROLE_MAP).forEach((dbRole) => {
      expect(validDbRoles.has(dbRole)).toBe(true);
    });
  });

  it('covers all 8 form roles (exhaustiveness)', () => {
    const formRoles = [
      'PORT_OFFICER', 'FINANCE_ADMIN', 'COMPLIANCE_AUDITOR', 'OPERATIONS_MANAGER',
      'SHIPPING_AGENT', 'FLEET_MANAGER', 'FINANCE_CONTACT', 'LEGAL_REP',
    ];
    formRoles.forEach((role) => {
      expect(ROLE_MAP[role as keyof typeof ROLE_MAP]).toBeDefined();
    });
    expect(Object.keys(ROLE_MAP)).toHaveLength(8);
  });
});
