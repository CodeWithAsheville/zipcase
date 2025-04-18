import SearchParser from '../SearchParser';

describe('SearchParser', () => {
    describe('parseSearchInput', () => {
        it('should return an empty array for null or empty input', () => {
            expect(SearchParser.parseSearchInput('')).toEqual([]);
            expect(SearchParser.parseSearchInput('   ')).toEqual([]);
            expect(SearchParser.parseSearchInput(null as any)).toEqual([]);
        });

        it('should extract case numbers in YYCRnnnnnn-CCC format', () => {
            expect(SearchParser.parseSearchInput('22CR123456-590')).toEqual(['22CR123456-590']);
            expect(
                SearchParser.parseSearchInput(
                    'This is case 23CV123456-123 and another 21PR987654-789'
                )
            ).toEqual(['23CV123456-123', '21PR987654-789']);
        });

        it('should match case numbers within arbitrary text', () => {
            expect(
                SearchParser.parseSearchInput('ABCXYZ22CR123456-590123 @#%^&17IF987654-3210000!@#$')
            ).toEqual(['22CR123456-590', '17IF987654-321']);
            expect(SearchParser.parseSearchInput('This has letter 23CV123456-123B')).toEqual([
                '23CV123456-123',
            ]);
        });

        it('should convert Lexis Nexis formatted case numbers', () => {
            // Format: {county_code}{XX}{year}{case_type} {case_no}
            // Example: 5902022CR 714844 => 22CR714844-590
            expect(SearchParser.parseSearchInput('5902022CR 714844')).toEqual(['22CR714844-590']);
            expect(SearchParser.parseSearchInput('1232023CV 123456')).toEqual(['23CV123456-123']);
        });

        it('should handle multiple Lexis Nexis case numbers', () => {
            expect(SearchParser.parseSearchInput('5902022CR 714844 1232023CV 123456')).toEqual([
                '22CR714844-590',
                '23CV123456-123',
            ]);
        });

        it("should ignore text that doesn't match case number patterns", () => {
            expect(SearchParser.parseSearchInput('This is just text with no case numbers')).toEqual(
                []
            );
            expect(SearchParser.parseSearchInput('Case 123456 without proper format')).toEqual([]);
        });
    });
});
