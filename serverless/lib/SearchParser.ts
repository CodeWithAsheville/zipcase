const SearchParser = {
    parseSearchInput(input: string): string[] {
        if (!input || input.trim() === '') {
            return [];
        }

        // Convert any Lexis Nexis formatted case numbers to standard format
        // Example: 5902022CR 714844 => 22CR714844-590
        const normalized = input.replace(
            /(?<county_code>\d{3})(?:19|20)(?<year>\d{2})(?<case_type>[A-Za-z]{2})?(?:S|\s\n?)?(?<case_no>\d{6})/g,
            (_match, ...args) => {
                const groups = args[args.length - 1];
                const caseType = groups.case_type || 'CR';
                return `${groups.year}${caseType}${groups.case_no}-${groups.county_code}`;
            }
        );

        // Extract case numbers matching the format: YYCRnnnnnn-CCC
        const caseNumbers = [];
        const regex = /\d{2}[A-Za-z]{2}\d{6}-\d{3}/g;
        let match;

        while ((match = regex.exec(normalized)) !== null) {
            caseNumbers.push(match[0]);
        }

        return caseNumbers;
    },
};

export default SearchParser;
