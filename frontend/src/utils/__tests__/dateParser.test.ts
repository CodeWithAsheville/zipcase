import { parseDate, formatDate } from '../dateParser';

// Mock current date to ensure consistent test results
const mockDate = new Date(2025, 3, 15); // April 15, 2025

function withMockedDate(fn: () => void) {
    const originalNow = Date.now;

    try {
        // Mock Date.now() to return our fixed date
        // @ts-ignore - vitest can use this format for mocking
        Date.now = () => mockDate.getTime();

        fn();
    } finally {
        Date.now = originalNow;
    }
}

describe('parseDate', () => {
    test('should handle MM/DD/YYYY format in the past', () => {
        withMockedDate(() => {
            const result = parseDate('05/08/1989');
            expect(result?.getFullYear()).toBe(1989);
            expect(result?.getMonth()).toBe(4); // May is month 4 (0-indexed)
            expect(result?.getDate()).toBe(8);
        });
    });

    test('should handle DD/MM/YYYY format when day is greater than 12', () => {
        withMockedDate(() => {
            const result = parseDate('19/05/1989');
            expect(result?.getFullYear()).toBe(1989);
            expect(result?.getMonth()).toBe(4); // May is month 4 (0-indexed)
            expect(result?.getDate()).toBe(19);
        });
    });

    test('should handle MM-DD-YYYY format', () => {
        withMockedDate(() => {
            const result = parseDate('03-15-2020');
            expect(result?.getFullYear()).toBe(2020);
            expect(result?.getMonth()).toBe(2); // March is month 2 (0-indexed)
            expect(result?.getDate()).toBe(15);
        });
    });

    test('should handle spelled-out month names', () => {
        withMockedDate(() => {
            const result = parseDate('March 2, 1995');
            expect(result?.getFullYear()).toBe(1995);
            expect(result?.getMonth()).toBe(2); // March is month 2 (0-indexed)
            expect(result?.getDate()).toBe(2);
        });
    });

    test('should handle abbreviated month names', () => {
        withMockedDate(() => {
            const result = parseDate('mar 2 95');
            expect(result?.getFullYear()).toBe(1995);
            expect(result?.getMonth()).toBe(2); // March is month 2 (0-indexed)
            expect(result?.getDate()).toBe(2);
        });
    });

    test('should handle YYYYMMDD format', () => {
        withMockedDate(() => {
            const result = parseDate('20020519');
            expect(result?.getFullYear()).toBe(2002);
            expect(result?.getMonth()).toBe(4); // May is month 4 (0-indexed)
            expect(result?.getDate()).toBe(19);
        });
    });

    test('should assume month-first when format is ambiguous', () => {
        withMockedDate(() => {
            const result = parseDate('5/8/89');
            expect(result?.getFullYear()).toBe(1989);
            expect(result?.getMonth()).toBe(4); // May is month 4 (0-indexed)
            expect(result?.getDate()).toBe(8);
        });
    });

    test('should handle DD.MM.YYYY format', () => {
        withMockedDate(() => {
            const result = parseDate('19.5.89');
            expect(result?.getFullYear()).toBe(1989);
            expect(result?.getMonth()).toBe(4); // May is month 4 (0-indexed)
            expect(result?.getDate()).toBe(19);
        });
    });

    test('should interpret 2-digit years based on current year to ensure they are in the past', () => {
        withMockedDate(() => {
            // Current year is 2025, so '24' should be 2024 (last year)
            const result1 = parseDate('3/15/24');
            expect(result1?.getFullYear()).toBe(2024);

            // '30' should be 1930 because 2030 would be in the future
            const result2 = parseDate('7/4/30');
            expect(result2?.getFullYear()).toBe(1930);

            // '95' is less than the current year, so should be 1995
            const result3 = parseDate('10/10/95');
            expect(result3?.getFullYear()).toBe(1995);
        });
    });

    test('should correctly handle years with apostrophe', () => {
        withMockedDate(() => {
            // Test '89 -> 1989 (not 1999)
            const result = parseDate("May 15, '89");
            expect(result?.getFullYear()).toBe(1989);
            expect(result?.getMonth()).toBe(4); // May
            expect(result?.getDate()).toBe(15);

            // Test '05 -> 2005
            const result2 = parseDate("January 1, '05");
            expect(result2?.getFullYear()).toBe(2005);

            // Test '50 -> 1950 (not 2050 which would be future)
            const result3 = parseDate("Dec 25, '50");
            expect(result3?.getFullYear()).toBe(1950);
        });
    });

    test('should reject dates in the future', () => {
        withMockedDate(() => {
            // April 15, 2025 is our mocked "today"
            // Future date should be rejected
            expect(parseDate('05/01/2025')).toBeNull(); // May 1, 2025 (future)
            expect(parseDate('12/31/2025')).toBeNull(); // Dec 31, 2025 (future)
            expect(parseDate('01/01/2026')).toBeNull(); // Next year

            // Past/current dates should be accepted
            expect(parseDate('04/15/2025')).not.toBeNull(); // Today
            expect(parseDate('01/01/2025')).not.toBeNull(); // Earlier this year
            expect(parseDate('12/31/2024')).not.toBeNull(); // Last year
        });
    });

    test('should reject invalid dates without auto-correction', () => {
        withMockedDate(() => {
            expect(parseDate('February 30, 2020')).toBeNull(); // Invalid day for February
            expect(parseDate('4/31/2000')).toBeNull(); // April doesn't have 31 days
            expect(parseDate('13/13/2000')).toBeNull(); // Invalid month 13
            expect(parseDate('0/1/2000')).toBeNull(); // Invalid month 0
        });
    });

    test('should return null for invalid date strings', () => {
        expect(parseDate('')).toBeNull();
        expect(parseDate('invalid date')).toBeNull();
        expect(parseDate('13/32/2020')).toBeNull(); // Invalid month and day
    });
});

describe('formatDate', () => {
    test('should format a Date object to a readable string', () => {
        const date = new Date(1989, 4, 8); // May 8, 1989
        expect(formatDate(date)).toBe('May 8, 1989');
    });

    test('should handle single-digit days', () => {
        const date = new Date(2020, 0, 1); // January 1, 2020
        expect(formatDate(date)).toBe('January 1, 2020');
    });

    test('should return empty string for invalid dates', () => {
        const invalidDate = new Date('invalid');
        expect(formatDate(invalidDate)).toBe('');
    });
});