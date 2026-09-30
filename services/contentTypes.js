/**
 * Content types that share the short-link machinery (access, unlock, reports,
 * analytics, tags). One entry per type says where its data lives, so shared
 * services can work on any of them by name.
 *
 *   table         database table
 *   noun          what visitors see it called ("This paste has expired.")
 *   eventLabel    what one visit is called on its analytics page
 *   ownerColumn   users.id of the owner
 *   usedColumn    how often it was opened (clicks, views, downloads)
 *   limitColumn   the maximum for usedColumn (NULL = no limit)
 *   feature       features.* switch the type depends on (null: always on)
 *   quarantine    whether the table has isQuarantined (reports can quarantine it)
 *   restricted    whether sharingMode = 'restricted' + allowedUsers apply
 *   destination   column shown on the quarantine warning
 *   publicPrefix  public path before the slug
 *   infoPrefix    public info page before the slug, if any
 *   alwaysRemember  a password unlock lasts the session (no "remember" choice)
 */
const CONTENT_TYPES = {
  url: {
    table: 'urls',
    noun: 'link',
    eventLabel: 'Clicks',
    ownerColumn: 'creatorId',
    usedColumn: 'clicks',
    limitColumn: 'maxUses',
    feature: null,
    quarantine: true,
    restricted: false,
    destination: 'longUrl',
    publicPrefix: '/s/',
    infoPrefix: '/info/',
    alwaysRemember: false
  },
  bundle: {
    table: 'bundles',
    noun: 'bundle',
    eventLabel: 'Opens',
    ownerColumn: 'creatorId',
    usedColumn: 'clicks',
    limitColumn: 'maxUses',
    feature: 'bundles',
    quarantine: true,
    restricted: false,
    destination: 'title',
    publicPrefix: '/b/',
    infoPrefix: null,
    alwaysRemember: true
  },
  paste: {
    table: 'pastes',
    noun: 'paste',
    eventLabel: 'Views',
    ownerColumn: 'userId',
    usedColumn: 'views',
    limitColumn: 'maxViews',
    feature: 'pastes',
    quarantine: true,
    restricted: false,
    destination: 'title',
    publicPrefix: '/p/',
    infoPrefix: '/p-info/',
    alwaysRemember: false
  },
  file: {
    table: 'files',
    noun: 'file',
    eventLabel: 'Downloads',
    ownerColumn: 'userId',
    usedColumn: 'downloads',
    limitColumn: 'maxDownloads',
    feature: 'files',
    quarantine: true,
    restricted: true,
    destination: 'originalName',
    publicPrefix: '/f/',
    infoPrefix: null,
    alwaysRemember: false
  }
};

function contentType(type) {
  const info = CONTENT_TYPES[type];
  if (!info) throw new Error(`Unknown content type: ${type}`);
  return info;
}

module.exports = { CONTENT_TYPES, contentType };
