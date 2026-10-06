const { contentType } = require('./contentTypes');
const { recordStatus } = require('./accessService');

/**
 * What a chat app (WhatsApp, Telegram, Slack, …) shows when a public page is shared: `share` for
 * partials/head, which turns it into og:description and og:url. Metadata only (what the item is, how big),
 * never its content. No og:image on purpose: the preview is a text card (see services/linkPreviewBots.js).
 */
const MAX_DESCRIPTION = 200;

/**
 * @param {object} options - { baseUrl, path, facts: strings joined with " · " (empty ones left out) }
 * @returns {{ description: string, url: string }}
 */
function share({ baseUrl, path, facts }) {
  let description = facts.filter(Boolean).map(fact => String(fact).replace(/\s+/g, ' ').trim()).join(' · ');
  if (description.length > MAX_DESCRIPTION) description = `${description.slice(0, MAX_DESCRIPTION - 1)}…`;
  return { description, url: `${baseUrl}${path}` };
}

/**
 * The preview of an item, or null (the generic site preview) for one that is locked (password, restricted file),
 * reported or unavailable.
 * @param {object} options - { baseUrl, path (default: the item's public address), facts }
 */
function itemShare(type, record, { baseUrl, path, facts }) {
  const locked = record.password || (contentType(type).restricted && record.sharingMode === 'restricted');
  if (locked || recordStatus(type, record) !== 'active') return null;
  return share({ baseUrl, path: path || `${contentType(type).publicPrefix}${record.slug}`, facts });
}

/** "1 line", "3 lines" */
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

module.exports = { share, itemShare, count };
