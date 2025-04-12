import * as humanparser from 'humanparser';

const NameParser = {
    /**
     * Parse a name string and standardize to "last, first middle" format
     * using the humanparser library to handle complex name structures
     *
     * @param name Input name string
     * @returns Standardized name in "last, first middle" format
     */
    parseAndStandardizeName(name: string): string {
        if (!name || typeof name !== 'string') {
            return '';
        }

        // Remove excess whitespace and normalize
        const normalizedName = name.trim().replace(/\s+/g, ' ');
        if (!normalizedName) {
            return '';
        }

        // Check if name already contains a comma (assuming "last, first [middle]" format)
        if (normalizedName.includes(',')) {
            const [lastPart, firstPart] = normalizedName.split(',').map(part => part.trim());

            if (lastPart && firstPart) {
                return `${lastPart}, ${firstPart}`;
            }

            return normalizedName;
        }

        try {
            const parsedName = humanparser.parseName(normalizedName);

            const lastName = parsedName.lastName || '';

            let firstMiddlePart = parsedName.firstName || '';
            if (parsedName.middleName && parsedName.middleName.trim()) {
                firstMiddlePart += ` ${parsedName.middleName}`;
            }

            if (lastName && firstMiddlePart) {
                return `${lastName}, ${firstMiddlePart}`;
            }

            if (lastName) {
                return lastName;
            }

            if (firstMiddlePart) {
                return firstMiddlePart;
            }

            // Fallback to the original name if parsing fails
            return normalizedName;
        } catch {
            // If humanparser fails, fall back to a simpler algorithm
            const parts = normalizedName.split(' ');

            if (parts.length === 1) {
                return normalizedName;
            }

            // Extract the last name (may be hyphenated)
            const lastName = parts[parts.length - 1];

            // Extract first name and middle parts
            const firstAndMiddleParts = parts.slice(0, parts.length - 1).join(' ');

            return `${lastName}, ${firstAndMiddleParts}`;
        }
    },
};

export default NameParser;
