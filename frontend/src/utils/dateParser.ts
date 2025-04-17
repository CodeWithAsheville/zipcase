/**
 * Attempts to parse a date string in various formats and return a Date object.
 * Handles various input formats including:
 * - MM/DD/YYYY, MM-DD-YYYY, MM.DD.YYYY
 * - DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (when day > 12 or month is spelled out)
 * - Month DD, YYYY (e.g., "January 15, 2020", "Jan 15 2020")
 * - YYYYMMDD (e.g., "20220130")
 * - Natural language (e.g., "mar 2 95")
 *
 * @param dateStr - The date string to parse
 * @returns Date object if parsing successful, null otherwise
 */
export function parseDate(dateStr: string): Date | null {
    if (!dateStr || typeof dateStr !== 'string') {
        return null;
    }

    // Remove extra whitespace and normalize
    const normalizedStr = dateStr.trim().toLowerCase();
    if (!normalizedStr) {
        return null;
    }

    // Get current date/time - use Date.now() for better testability
    const now = new Date(Date.now());
    const currentYear = now.getFullYear();
    const currentDate = now;

    // Try to parse a date in YYYYMMDD format (e.g., "20220130")
    if (/^\d{8}$/.test(normalizedStr)) {
        const year = parseInt(normalizedStr.substring(0, 4), 10);
        const month = parseInt(normalizedStr.substring(4, 6), 10) - 1; // JS months are 0-based
        const day = parseInt(normalizedStr.substring(6, 8), 10);

        const date = new Date(year, month, day);
        // Only accept if both month and day are valid - don't auto-correct invalid dates
        if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
            // Only accept dates in the past
            if (date <= currentDate) {
                return date;
            }
        }
        return null;
    }

    // Handle natural language date inputs like "mar 2 95" or "january 15 2020"
    const monthNames = {
        jan: 0, january: 0,
        feb: 1, february: 1,
        mar: 2, march: 2,
        apr: 3, april: 3,
        may: 4,
        jun: 5, june: 5,
        jul: 6, july: 6,
        aug: 7, august: 7,
        sep: 8, september: 8,
        oct: 9, october: 9,
        nov: 10, november: 10,
        dec: 11, december: 11
    };

    // Look for month names in the input
    for (const [monthName, monthIndex] of Object.entries(monthNames)) {
        if (normalizedStr.includes(monthName)) {
            // Extract the parts (day and year)
            const parts = normalizedStr.replace(monthName, '').trim().split(/\s+/);
            if (parts.length >= 2) {
                const day = parseInt(parts[0], 10);

                // Check for apostrophe year format like '89
                const apostropheYearMatch = parts[1].match(/[''](\d{2})/);
                let year;

                if (apostropheYearMatch) {
                    year = parseInt(apostropheYearMatch[1], 10);
                } else {
                    year = parseInt(parts[1], 10);
                }

                // Handle 2-digit years (including with apostrophe like '89)
                if (year < 100) {
                    // Check which century to use based on current year context
                    const currentYearLastTwoDigits = currentYear % 100;

                    // If the 2-digit year is greater than current year's last two digits
                    // it must be from the previous century (e.g., '89 → 1989 when current year is 2025)
                    year = year > currentYearLastTwoDigits ? 1900 + year : 2000 + year;

                    // If the resulting year is still in the future, use previous century
                    if (year > currentYear) {
                        year -= 100;
                    }
                }

                const date = new Date(year, monthIndex, day);
                // Only accept if both month and day are valid - don't auto-correct invalid dates
                if (date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day) {
                    // Only accept dates in the past
                    if (date <= currentDate) {
                        return date;
                    }
                }
            }
        }
    }

    // Split the string and try to determine the format
    const separators = ['/', '-', '.', ' '];
    let parts: string[] = [];

    for (const separator of separators) {
        if (normalizedStr.includes(separator)) {
            parts = normalizedStr.split(separator).map(p => p.trim());
            break;
        }
    }

    if (parts.length === 3) {
        // Try to determine which parts are month, day, year
        let month = -1;
        let day = -1;
        let year = -1;

        // Check for spelled-out month names
        for (let i = 0; i < 3; i++) {
            const part = parts[i];
            if (Object.keys(monthNames).some(name => part.includes(name))) {
                for (const [monthName, monthIndex] of Object.entries(monthNames)) {
                    if (part.includes(monthName)) {
                        month = monthIndex;
                        const otherParts = [parts[(i+1)%3], parts[(i+2)%3]];
                        // Determine which of the other parts is day and which is year
                        const yearPart = otherParts.find(p => parseInt(p) > 31);
                        const dayPart = otherParts.find(p => p !== yearPart);

                        if (yearPart) year = parseInt(yearPart);
                        if (dayPart) day = parseInt(dayPart);

                        break;
                    }
                }
                break;
            }
        }

        // If no spelled-out month was found, try numeric parts
        if (month === -1) {
            const allNumbers = parts.every(p => !isNaN(parseInt(p, 10)));

            if (allNumbers) {
                const first = parseInt(parts[0], 10);
                const second = parseInt(parts[1], 10);
                const third = parseInt(parts[2], 10);

                // Check for invalid month values first
                if (first === 0 || first > 12) {
                    // If interpreting first part as month, it's invalid
                    if (second === 0 || second > 12) {
                        // Both parts would be invalid as months
                        return null;
                    }
                    // First part must be day, second part must be month
                    day = first;
                    month = second - 1;
                } else if (second > 12) {
                    // Second part must be day, meaning first is month
                    month = first - 1;
                    day = second;
                } else {
                    // Ambiguous case, default to month first (American format)
                    month = first - 1;
                    day = second;
                }

                // Double-check month range
                if (month < 0 || month > 11) {
                    return null;
                }

                year = third;
            }
        }

        // Handle 2-digit years (including with apostrophe like '89)
        if (year < 100) {
            // Check which century to use based on current year context
            const currentYearLastTwoDigits = currentYear % 100;

            // If the 2-digit year is greater than current year's last two digits
            // it must be from the previous century (e.g., '89 → 1989 when current year is 2025)
            year = year > currentYearLastTwoDigits ? 1900 + year : 2000 + year;

            // If the resulting year is still in the future, use previous century
            if (year > currentYear) {
                year -= 100;
            }
        }

        if (month >= 0 && day > 0 && year > 0) {
            const date = new Date(year, month, day);
            // Only accept if both month and day are valid - don't auto-correct invalid dates
            if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
                // Only accept dates in the past
                if (date <= currentDate) {
                    return date;
                }
            }
        }
    }

    return null;
}

/**
 * Formats a Date object to a human-readable string
 * @param date - The Date object to format
 * @returns A formatted date string like "January 15, 2020"
 */
export function formatDate(date: Date): string {
    if (!isValidDate(date)) {
        return '';
    }

    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const month = monthNames[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();

    return `${month} ${day}, ${year}`;
}

/**
 * Checks if a Date object is valid
 * @param date - The Date object to check
 * @returns True if the date is valid, false otherwise
 */
function isValidDate(date: Date | null): boolean {
    return date instanceof Date && !isNaN(date.getTime());
}