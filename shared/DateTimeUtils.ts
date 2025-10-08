/**
 * Parse a US-style date string (MM/dd/yyyy) into a UTC Date at midnight.
 * Returns null when input is falsy or malformed.
 */
export function parseUsDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr || typeof dateStr !== 'string') return null;

    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;

    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    if (Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(year)) return null;

    return new Date(Date.UTC(year, month - 1, day));
}

export function formatIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function formatDisplayDate(date: Date, locale?: string): string {
    return date.toLocaleDateString(locale ?? undefined, { timeZone: 'UTC' });
}

/**
 * Parse a flexible date string into a UTC Date at midnight where appropriate.
 * - If input is YYYY-MM-DD -> treat as UTC date at midnight
 * - If input is MM/dd/yyyy -> use parseUsDate
 * - Otherwise, attempt `new Date(input)` and return only if valid
 */
export function parseDateString(dateStr: string | null | undefined): Date | null {
    if (!dateStr || typeof dateStr !== 'string') return null;

    // YYYY-MM-DD (date-only) -> UTC midnight
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return new Date(dateStr + 'T00:00:00Z');
    }

    // MM/dd/yyyy -> portal US date format
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
        return parseUsDate(dateStr);
    }

    // Otherwise try built-in parsing (ISO timestamps etc.)
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}
