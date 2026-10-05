const db = require('../config/database');
const { contentType } = require('./contentTypes');
const { log, ACTIONS, CATEGORIES } = require('./auditService');

/**
 * Slugs for every content type (the part after /s/, /b/, /p/, /f/).
 *
 *   A type's slugs are unique within that type only: /s/thing and /b/thing can both exist.
 *   They ignore case: /s/Promo and /s/promo are the same short link (the case as typed is kept).
 *   1-20 characters: letters, digits, - and _. Random ones are 5 characters.
 *
 * The database backs this up with a unique NOCASE index per table (migrateSlugCase).
 */

class SlugError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const RANDOM_LENGTH = 5;
const ATTEMPTS = 10;
const PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
const RULE = 'A short link must be 1-20 characters: letters, numbers, - and _.';

const slugService = {
  SlugError,

  /** What is wrong with a slug's format, or null. */
  problem(slug) {
    return typeof slug === 'string' && PATTERN.test(slug) ? null : RULE;
  },

  /** Whether another item of this type has the slug, ignoring case. */
  isTaken(type, slug, { exceptId = null } = {}) {
    const { table } = contentType(type);
    return !!db.prepare(`SELECT id FROM ${table} WHERE slug = ? COLLATE NOCASE AND id IS NOT ?`).get(slug, exceptId);
  },

  /** The item of this type with the slug, ignoring case. */
  find(type, slug) {
    const { table } = contentType(type);
    return db.prepare(`SELECT * FROM ${table} WHERE slug = ? COLLATE NOCASE`).get(slug);
  },

  /** A free random slug. */
  generate(type) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      let slug = '';
      for (let i = 0; i < RANDOM_LENGTH; i++) slug += CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      if (!slugService.isTaken(type, slug)) return slug;
    }
    throw new Error('Unable to generate a unique slug after multiple attempts');
  },

  /**
   * The requested slug (trimmed) if it is valid and free, a random one when none is requested.
   * @throws {SlugError} invalid or taken
   */
  resolve(type, requested, { exceptId = null } = {}) {
    const slug = requested === undefined || requested === null ? '' : String(requested).trim();
    if (!slug) return slugService.generate(type);
    const problem = slugService.problem(slug);
    if (problem) throw new SlugError(problem);
    if (slugService.isTaken(type, slug, { exceptId })) {
      throw new SlugError(`The short link "${slug}" is already taken. Please choose another.`);
    }
    return slug;
  },

  /** Audit log for a changed slug: an admin action when a site admin changes someone else's item. */
  logChange(req, type, item, slug) {
    const info = contentType(type);
    const byAdmin = !!(req.user && req.user.isAdmin) && item[info.ownerColumn] !== req.user.id;
    log({
      req,
      action: ACTIONS.CHANGE_SLUG,
      category: byAdmin ? CATEGORIES.ADMIN_ACTION : CATEGORIES.ACCOUNT_CHANGE,
      targetType: type,
      targetId: item.id,
      targetDescription: `${info.publicPrefix}${item.slug} → ${info.publicPrefix}${slug}`,
      details: { from: item.slug, to: slug }
    });
  }
};

module.exports = slugService;
