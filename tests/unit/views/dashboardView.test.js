const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const configService = require('../../../services/configService');
const DashboardController = require('../../../controllers/dashboardController');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createTestTag, tagItem,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// The dashboard template: one toolbar, type pills with counts, dense rows with the same shape for every type.

const VIEWS = path.join(__dirname, '../../../views');
let alice;

beforeEach(async () => {
  const row = await createTestUser({ username: 'alice', email: 'a@example.com', role: 'trusted' });
  alice = { id: row.id, username: 'alice', isAdmin: 0, role: 'trusted' };
});

function viewData(query = {}) {
  const res = createMockResponse();
  DashboardController.getUserDashboard(createMockRequest({
    user: alice, session: { userId: alice.id, isAdmin: false }, query, protocol: 'http', get: () => 'localhost'
  }), res);
  return res;
}

async function render(query = {}, can = {}) {
  const res = viewData(query);
  return ejs.renderFile(path.join(VIEWS, `${res._view}.ejs`), {
    views: [VIEWS],
    ...res._viewData,
    features: configService.getSettings().features,
    can: { analytics: true, tags: true, createPastes: true, createBundles: true, ...can }
  });
}

const rowOf = (html, type, id) => html.split('class="item-row').find(part => part.includes(`data-type="${type}" data-id="${id}"`)) || '';

describe('rows', () => {
  let url, bundle, paste, file;
  beforeEach(() => {
    url = createTestUrl({ slug: 'link', creatorId: alice.id, longUrl: 'https://example.com/page', clicks: 3, maxUses: 10 });
    bundle = createTestBundle({ slug: 'kit', creatorId: alice.id, title: 'Launch kit', password: 'x' });
    paste = createTestPaste(alice.id, { slug: 'note', title: 'Meeting notes' });
    file = createTestFile(alice.id, { slug: 'doc', originalName: 'report.pdf', size: 2048 });
  });

  it('every type gets the same row: icon, short link, label, meta, status, actions', async () => {
    const html = await render();
    for (const [type, item, short, label] of [
      ['url', url, '/s/link', 'https://example.com/page'],
      ['bundle', bundle, '/b/kit', 'Launch kit'],
      ['paste', paste, '/p/note', 'Meeting notes'],
      ['file', file, '/f/doc', 'report.pdf']
    ]) {
      const row = rowOf(html, type, item.id);
      expect(row).toContain('class="item-type"');
      expect(row).toContain(`>${short}</a>`);
      expect(row).toContain(label);
      expect(row).toContain('class="item-meta"');
      expect(row).toMatch(/class="badge[^"]*"/);
      expect(row).toContain('data-action="copy"');
      expect(row).toContain(`data-copy="http://localhost${short}"`);
      expect(row).toContain('data-action="edit"');
      expect(row).toContain('data-action="delete"');
      expect(row).toContain('aria-haspopup="menu"');
    }
  });

  it('shows uses with the type\'s noun and the limit', async () => {
    const html = await render();
    expect(rowOf(html, 'url', url.id)).toMatch(/3 \/ 10 clicks/);
    expect(rowOf(html, 'paste', paste.id)).toMatch(/0 views/);
    expect(rowOf(html, 'file', file.id)).toMatch(/2\.0 KB/);
  });

  it('marks password-protected items', async () => {
    const html = await render();
    expect(rowOf(html, 'bundle', bundle.id)).toContain('Password-protected');
    expect(rowOf(html, 'url', url.id)).not.toContain('Password-protected');
  });

  it('edits each type its own way', async () => {
    const html = await render();
    expect(rowOf(html, 'paste', paste.id)).toMatch(new RegExp(`href="/pastes/${paste.id}/edit"[^>]*data-action="edit"`));
    expect(rowOf(html, 'url', url.id)).toMatch(/<button[^>]*data-action="edit"/);
  });

  it('QR codes and analytics follow their switches and permissions', async () => {
    let html = await render();
    expect(rowOf(html, 'url', url.id)).toContain('data-action="qr"');
    expect(rowOf(html, 'url', url.id)).toContain(`href="/analytics/url/${url.id}"`);
    html = await render({}, { analytics: false });
    expect(rowOf(html, 'url', url.id)).not.toContain('/analytics/url/');
  });
});

describe('toolbar and pills', () => {
  it('one search form keeps the filters; pills show a count per type', async () => {
    createTestUrl({ slug: 'a', creatorId: alice.id });
    createTestUrl({ slug: 'b', creatorId: alice.id });
    createTestPaste(alice.id, { slug: 'p' });
    const html = await render({ type: 'url', sort: 'oldest' });

    expect(html.match(/<form[^>]*id="dashFilters"/g)).toHaveLength(1);
    expect(html).toMatch(/<input[^>]*type="search"[^>]*name="search"/);
    expect(html).toMatch(/<option value="oldest" selected>/);
    expect(html).toMatch(/<input type="hidden" name="type" value="url">/);
    expect(html).toMatch(/data-type-pill="url"[^>]*aria-current="page"[^>]*>\s*Links\s*<span class="pill-count">2<\/span>/);
    expect(html).toMatch(/data-type-pill="paste"[^>]*>\s*Pastes\s*<span class="pill-count">1<\/span>/);
    expect(html).not.toContain('Apply</button>');
  });

  it('offers the user\'s tags as a filter', async () => {
    const tag = createTestTag({ name: 'launch', userId: alice.id, color: '#60a5fa' });
    tagItem('url', createTestUrl({ slug: 't', creatorId: alice.id }).id, tag.id);
    const html = await render({ tag: 'launch' });
    expect(html).toMatch(/<select[^>]*\bmultiple\b[^>]*name="tag"/);
    expect(html).toMatch(/<option value="launch" data-color="#60a5fa" data-hint="1" selected>launch<\/option>/);
    expect(html).toMatch(/<input type="hidden" id="dashTagMatch" name="match" value="any">/);
  });

  it('keeps several tags and "all" in the page links', async () => {
    const a = createTestTag({ name: 'a', userId: alice.id });
    const b = createTestTag({ name: 'b', userId: alice.id });
    for (let i = 0; i < 30; i++) {
      const url = createTestUrl({ slug: `u${i}`, creatorId: alice.id });
      tagItem('url', url.id, a.id);
      tagItem('url', url.id, b.id);
    }
    const html = await render({ tag: ['a', 'b'], match: 'all', limit: '25' });
    expect(html).toMatch(/<input type="hidden" id="dashTagMatch" name="match" value="all">/);
    expect(html).toContain('href="/dashboard?tag=a&amp;tag=b&amp;match=all&amp;limit=25&amp;page=2"');
  });

  it('has no tag filter without tags', async () => {
    createTestUrl({ slug: 'a', creatorId: alice.id });
    expect(await render()).not.toMatch(/name="tag"/);
  });

  it('pages with links that keep the filters', async () => {
    for (let i = 0; i < 30; i++) createTestUrl({ slug: `u${i}`, creatorId: alice.id });
    const html = await render({ limit: '25', search: 'u' });
    expect(html).toContain('Page 1 of 2');
    expect(html).toMatch(/href="\/dashboard\?search=u&amp;limit=25&amp;page=2"/);
  });
});

describe('empty states', () => {
  it('a new account is invited to create something', async () => {
    const html = await render();
    expect(html).toContain('Nothing here yet');
    expect(html).toMatch(/href="\/"[^>]*>[^<]*Create/);
  });

  it('filters without matches offer to clear them', async () => {
    createTestUrl({ slug: 'a', creatorId: alice.id });
    const html = await render({ search: 'zzz' });
    expect(html).toContain('No items match');
    expect(html).toMatch(/href="\/dashboard"[^>]*>\s*Clear filters/);
  });
});

describe('the live-search partial', () => {
  it('renders the results on their own', async () => {
    createTestUrl({ slug: 'link', creatorId: alice.id });
    const html = await render({ partial: '1' });
    expect(html).toContain('class="item-row');
    expect(html).toContain('data-type-pill="all"');
    expect(html).not.toContain('<html');
    expect(html).not.toContain('id="dashFilters"');
  });
});

describe('no inline styling', () => {
  it.each(['dashboard.ejs', 'partials/dashboard-results.ejs'])('%s has no <style> blocks or style attributes', (file) => {
    const source = fs.readFileSync(path.join(VIEWS, file), 'utf8');
    expect(source).not.toMatch(/<style/);
    expect(source).not.toMatch(/\sstyle="/);
    expect(source).not.toMatch(/\sonclick=/);
  });
});

describe('row menus', () => {
  // The ⋯ menu of the last rows hangs below the list: a list that clips its content (overflow: hidden) cuts it off
  it('the list never clips its rows (the menus of the last rows stay reachable)', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../../public/css/items.css'), 'utf8');
    const rule = css.match(/\n\.item-list \{[^}]*\}/)[0];
    expect(rule).not.toMatch(/overflow/);
  });
});
