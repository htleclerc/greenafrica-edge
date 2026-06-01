import { it, expect } from 'vitest';
import { __OWNER_NAV_ITEMS_FOR_TEST } from '../OwnerShell';

it('exposes Simulator, TCO and Disputes nav entries', () => {
    const hrefs = __OWNER_NAV_ITEMS_FOR_TEST.map((n) => n.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/owner/simulator', '/owner/tco', '/owner/disputes']));
    expect(hrefs).toEqual(expect.arrayContaining(['/owner/dashboard', '/owner/vessels', '/owner/invoices', '/owner/wallet', '/owner/alerts']));
});
