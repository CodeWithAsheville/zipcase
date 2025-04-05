import NameParser from '../NameParser';

describe('NameParser', () => {
  describe('parseAndStandardizeName', () => {
    test('handles already well-formatted names with comma', () => {
      expect(NameParser.parseAndStandardizeName('Smith, John')).toBe('Smith, John');
      expect(NameParser.parseAndStandardizeName('Smith, John David')).toBe('Smith, John David');
    });

    test('standardizes names without comma', () => {
      expect(NameParser.parseAndStandardizeName('John Smith')).toBe('Smith, John');
      expect(NameParser.parseAndStandardizeName('John David Smith')).toBe('Smith, John David');
    });

    test('handles hyphenated names', () => {
      expect(NameParser.parseAndStandardizeName('Mary Smith-Jones')).toBe('Smith-Jones, Mary');
      expect(NameParser.parseAndStandardizeName('Laura-Ann Smith-Jones')).toBe('Smith-Jones, Laura-Ann');
      expect(NameParser.parseAndStandardizeName('Jean-Claude Thompson')).toBe('Thompson, Jean-Claude');
    });
    
    test('handles complex multi-part names', () => {
      expect(NameParser.parseAndStandardizeName('Laura-Ann Maria Angelica Lopez-Garcia')).toBe('Lopez-Garcia, Laura-Ann Maria Angelica');
      expect(NameParser.parseAndStandardizeName('Juan Carlos Rivera Vega')).toBe('Vega, Juan Carlos Rivera');
      expect(NameParser.parseAndStandardizeName('Mary Elizabeth Anne Windsor-Mountbatten')).toBe('Windsor-Mountbatten, Mary Elizabeth Anne');
    });
    
    test('handles multipart surnames with prefixes', () => {
      // Germanic
      expect(NameParser.parseAndStandardizeName('Ludwig van Beethoven')).toBe('van Beethoven, Ludwig');
      expect(NameParser.parseAndStandardizeName('Richard von Krafft-Ebing')).toBe('von Krafft-Ebing, Richard');
      
      // Dutch
      expect(NameParser.parseAndStandardizeName('Vincent van Gogh')).toBe('van Gogh, Vincent');
      expect(NameParser.parseAndStandardizeName('Ludwig Van der Rohe')).toBe('Van der Rohe, Ludwig');
      
      // French
      expect(NameParser.parseAndStandardizeName('Charles de Gaulle')).toBe('de Gaulle, Charles');
      
      // Italian
      expect(NameParser.parseAndStandardizeName('Leonardo da Vinci')).toBe('da Vinci, Leonardo');
      
      // Spanish
      expect(NameParser.parseAndStandardizeName('Miguel de Cervantes')).toBe('de Cervantes, Miguel');
      
      // Arabic/Middle Eastern
      expect(NameParser.parseAndStandardizeName('Abdullah bin Hussein')).toBe('bin Hussein, Abdullah');
      
      // Mixed
      expect(NameParser.parseAndStandardizeName('Jean-Claude Van Damme')).toBe('Van Damme, Jean-Claude');
    });

    test('trims excess whitespace', () => {
      expect(NameParser.parseAndStandardizeName('  John   Smith  ')).toBe('Smith, John');
    });

    test('handles single name inputs', () => {
      expect(NameParser.parseAndStandardizeName('John')).toBe('John');
    });

    test('handles empty and invalid inputs', () => {
      expect(NameParser.parseAndStandardizeName('')).toBe('');
      expect(NameParser.parseAndStandardizeName('   ')).toBe('');
      // @ts-ignore: Testing invalid input
      expect(NameParser.parseAndStandardizeName(null)).toBe('');
      // @ts-ignore: Testing invalid input
      expect(NameParser.parseAndStandardizeName(undefined)).toBe('');
    });
  });
});