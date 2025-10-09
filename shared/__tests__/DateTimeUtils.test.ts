import { parseUsDate, formatDisplayDate, formatIsoDate, parseDateString } from '../DateTimeUtils';

describe('DateTimeUtils', () => {
    it('parses US dates (MM/dd/yyyy) to UTC midnight', () => {
        const d = parseUsDate('02/10/2021');
        expect(d).not.toBeNull();
        if (d) {
            expect(d.getUTCFullYear()).toBe(2021);
            expect(d.getUTCMonth()).toBe(1); // February = 1
            expect(d.getUTCDate()).toBe(10);
        }
    });

    it('formats a Date to ISO YYYY-MM-DD', () => {
        const d = new Date(Date.UTC(2021, 1, 10));
        expect(formatIsoDate(d)).toBe('2021-02-10');
    });

    it('formats a Date for display in current locale using UTC day', () => {
        const d = new Date(Date.UTC(2021, 1, 10));
        const expected = d.toLocaleDateString(undefined, { timeZone: 'UTC' });
        expect(formatDisplayDate(d)).toBe(expected);
    });

    it('parses date-only strings (YYYY-MM-DD) as UTC midnight', () => {
        const d = parseDateString('2021-02-10');
        expect(d).not.toBeNull();
        if (d) {
            expect(d.toISOString().startsWith('2021-02-10')).toBeTruthy();
        }
    });

    it('parses ISO timestamps', () => {
        const d = parseDateString('2021-02-10T05:00:00Z');
        expect(d).not.toBeNull();
        if (d) {
            expect(d.toISOString()).toBe('2021-02-10T05:00:00.000Z');
        }
    });

    it('parses US format via parseDateInput', () => {
        const d = parseDateString('03/15/2021');
        expect(d).not.toBeNull();
        if (d) {
            expect(d.getUTCFullYear()).toBe(2021);
            expect(d.getUTCMonth()).toBe(2); // March
            expect(d.getUTCDate()).toBe(15);
        }
    });

    it('returns null for invalid inputs', () => {
        expect(parseDateString('not-a-date')).toBeNull();
        expect(parseDateString('')).toBeNull();
        expect(parseDateString(null)).toBeNull();
    });
});
