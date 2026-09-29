const SlugGenerator = require('../../../services/slugGenerator');
const { createTestUrl } = require('../../setup/testHelpers');

describe('SlugGenerator', () => {
  describe('generateRandomSlug', () => {
    it('should return a 5-character string', () => {
      const slug = SlugGenerator.generateRandomSlug();
      expect(slug).toHaveLength(5);
    });

    it('should only contain URL-safe characters (A-Za-z0-9-_)', () => {
      const slug = SlugGenerator.generateRandomSlug();
      expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate different slugs on consecutive calls', () => {
      const slugs = new Set();
      for (let i = 0; i < 100; i++) {
        slugs.add(SlugGenerator.generateRandomSlug());
      }
      // With random generation, we expect most to be unique
      expect(slugs.size).toBeGreaterThan(90);
    });
  });

  describe('isValidSlug', () => {
    it('should return true for valid slugs', () => {
      expect(SlugGenerator.isValidSlug('abc')).toBe(true);
      expect(SlugGenerator.isValidSlug('ABC')).toBe(true);
      expect(SlugGenerator.isValidSlug('a1b2c')).toBe(true);
      expect(SlugGenerator.isValidSlug('test-slug')).toBe(true);
      expect(SlugGenerator.isValidSlug('test_slug')).toBe(true);
      expect(SlugGenerator.isValidSlug('a')).toBe(true); // 1 character
      expect(SlugGenerator.isValidSlug('12345678901234567890')).toBe(true); // 20 characters
    });

    it('should return false for invalid slugs', () => {
      expect(SlugGenerator.isValidSlug('')).toBe(false); // empty
      expect(SlugGenerator.isValidSlug('123456789012345678901')).toBe(false); // 21 chars - too long
      expect(SlugGenerator.isValidSlug('test slug')).toBe(false); // space
      expect(SlugGenerator.isValidSlug('test!slug')).toBe(false); // special char
      expect(SlugGenerator.isValidSlug('test@slug')).toBe(false); // @ symbol
      expect(SlugGenerator.isValidSlug('test/slug')).toBe(false); // forward slash
    });
  });

  describe('slugExists', () => {
    it('should return false for non-existent slug', () => {
      expect(SlugGenerator.slugExists('nonexistent')).toBe(false);
    });

    it('should return true for existing slug', () => {
      createTestUrl({ slug: 'existing' });
      expect(SlugGenerator.slugExists('existing')).toBe(true);
    });
  });

  describe('generateUniqueSlug', () => {
    it('should generate a unique slug', () => {
      const slug = SlugGenerator.generateUniqueSlug();
      expect(slug).toHaveLength(5);
      expect(SlugGenerator.isValidSlug(slug)).toBe(true);
    });

    it('should generate different slugs each time', () => {
      const slug1 = SlugGenerator.generateUniqueSlug();
      const slug2 = SlugGenerator.generateUniqueSlug();
      expect(slug1).not.toBe(slug2);
    });
  });

  describe('getValidSlug', () => {
    it('should return auto-generated slug when no custom slug provided', () => {
      const result = SlugGenerator.getValidSlug(null);
      expect(result.isCustom).toBe(false);
      expect(result.slug).toHaveLength(5);
      expect(SlugGenerator.isValidSlug(result.slug)).toBe(true);
    });

    it('should return auto-generated slug for empty string', () => {
      const result = SlugGenerator.getValidSlug('');
      expect(result.isCustom).toBe(false);
    });

    it('should return custom slug when valid', () => {
      const result = SlugGenerator.getValidSlug('myslug');
      expect(result.isCustom).toBe(true);
      expect(result.slug).toBe('myslug');
    });

    it('should throw error for invalid custom slug format', () => {
      expect(() => SlugGenerator.getValidSlug('invalid slug!')).toThrow(
        'Custom slug must be 1-20 characters (A-Z, a-z, 0-9, -, _)'
      );
    });

    it('should throw error for slug that is too long', () => {
      expect(() => SlugGenerator.getValidSlug('a'.repeat(21))).toThrow(
        'Custom slug must be 1-20 characters (A-Z, a-z, 0-9, -, _)'
      );
    });

    it('should throw error when custom slug already exists', () => {
      createTestUrl({ slug: 'taken' });
      expect(() => SlugGenerator.getValidSlug('taken')).toThrow(
        'Custom slug already exists. Please choose another.'
      );
    });
  });
});
