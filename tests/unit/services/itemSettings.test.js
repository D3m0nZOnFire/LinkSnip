const fs = require('fs');
const bcrypt = require('bcrypt');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { readSettings, SettingsError } = require('../../../services/itemSettings');

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});
const setSettings = (data) => {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(data));
  configService.reload();
};

const USER = { id: 1, isAdmin: 0 };
const DAY = 86400000;
const daysFromNow = (iso) => (new Date(iso) - Date.now()) / DAY;
const LIMIT = { url: 'maxUses', bundle: 'maxUses', paste: 'maxViews', file: 'maxDownloads' };

// Create: every setting is stored (null when not sent). Update: only what is sent changes.
describe('readSettings on create', () => {
  it.each(Object.keys(LIMIT))('%s: nothing sent → every setting empty', async (type) => {
    const { values } = await readSettings(type, {}, { user: USER });
    expect(values).toEqual({ expiresAt: null, activateAt: null, deactivateAt: null, password: null, [LIMIT[type]]: null });
  });

  it('expiry as days from now', async () => {
    const { values } = await readSettings('url', { expirationDays: '3' }, { user: USER });
    expect(daysFromNow(values.expiresAt)).toBeCloseTo(3, 1);
  });

  it.each([
    ['a date', '2027-01-02', '2027-01-02T00:00:00.000Z'],
    ['a date and time without a zone (UTC)', '2027-01-02T10:30', '2027-01-02T10:30:00.000Z'],
    ['an ISO time', '2027-01-02T10:30:00.000Z', '2027-01-02T10:30:00.000Z'],
    ['a time with an offset', '2027-01-02T12:30:00+02:00', '2027-01-02T10:30:00.000Z']
  ])('expiry as %s, stored as ISO UTC', async (_name, sent, stored) => {
    const { values } = await readSettings('paste', { expiresAt: sent }, { user: USER });
    expect(values.expiresAt).toBe(stored);
  });

  it.each([['activateDateTime', 'deactivateDateTime'], ['activateAt', 'deactivateAt']])(
    'schedule sent as %s / %s', async (from, until) => {
      const { values } = await readSettings('file', { [from]: '2027-03-01T08:00', [until]: '2027-04-01T08:00' }, { user: USER });
      expect(values.activateAt).toBe('2027-03-01T08:00:00.000Z');
      expect(values.deactivateAt).toBe('2027-04-01T08:00:00.000Z');
    }
  );

  it.each(Object.entries(LIMIT))('%s: the usage limit is sent as %s', async (type, field) => {
    const { values } = await readSettings(type, { [field]: '5' }, { user: USER });
    expect(values[field]).toBe(5);
  });

  it('empty values are "no setting"', async () => {
    const { values } = await readSettings('url', {
      expirationDays: '', maxUses: '', password: '   ', activateDateTime: '', deactivateDateTime: null
    }, { user: USER });
    expect(values).toEqual({ expiresAt: null, activateAt: null, deactivateAt: null, password: null, maxUses: null });
  });

  it('0 expiry days means no expiry', async () => {
    const { values } = await readSettings('bundle', { expirationDays: '0' }, { user: USER });
    expect(values.expiresAt).toBeNull();
  });

  it('hashes the password without surrounding spaces', async () => {
    const { values } = await readSettings('paste', { password: '  open sesame ' }, { user: USER });
    expect(await bcrypt.compare('open sesame', values.password)).toBe(true);
  });

  describe('anonymous expiry cap', () => {
    it.each([
      ['url', 'anonymous.urlExpirationDays', 30],
      ['bundle', 'anonymous.urlExpirationDays', 30],
      ['paste', 'anonymous.pasteExpirationDays', 30]
    ])('%s: no expiry becomes the cap (%s), a longer one is shortened, a shorter one kept', async (type) => {
      expect(daysFromNow((await readSettings(type, {}, { user: null })).values.expiresAt)).toBeCloseTo(30, 1);
      expect(daysFromNow((await readSettings(type, { expirationDays: '100' }, { user: null })).values.expiresAt)).toBeCloseTo(30, 1);
      expect(daysFromNow((await readSettings(type, { expirationDays: '5' }, { user: null })).values.expiresAt)).toBeCloseTo(5, 1);
    });

    it('applies to a date too, and follows the setting live', async () => {
      setSettings({ anonymous: { pasteExpirationDays: 7 } });
      const { values } = await readSettings('paste', { expiresAt: '2999-01-01' }, { user: null });
      expect(daysFromNow(values.expiresAt)).toBeCloseTo(7, 1);
    });

    it('does not apply to logged-in users', async () => {
      const { values } = await readSettings('url', {}, { user: USER });
      expect(values.expiresAt).toBeNull();
    });
  });
});

describe('readSettings on update', () => {
  const existing = {
    expiresAt: '2027-06-10T14:00:00.000Z', activateAt: '2027-01-01T09:00:00.000Z', deactivateAt: null,
    password: 'stored-hash', maxViews: 10
  };
  const update = (body) => readSettings('paste', body, { user: USER, existing });

  it('changes nothing that is not sent', async () => {
    expect((await update({})).values).toEqual({});
  });

  it('an empty value removes a setting', async () => {
    const { values } = await update({ expiresAt: '', activateAt: null, maxViews: '' });
    expect(values).toEqual({ expiresAt: null, activateAt: null, maxViews: null });
  });

  it('a new value replaces a setting', async () => {
    const { values } = await update({ expiresAt: '2027-08-01', activateAt: '2027-02-01T09:00', maxViews: '3' });
    expect(values).toEqual({ expiresAt: '2027-08-01T00:00:00.000Z', activateAt: '2027-02-01T09:00:00.000Z', maxViews: 3 });
  });

  it('the stored expiry date sent back (the form shows only the day) keeps its time', async () => {
    expect((await update({ expiresAt: '2027-06-10' })).values).toEqual({});
  });

  it('expirationDays empty removes the expiry', async () => {
    const { values } = await readSettings('url', { expirationDays: null }, { user: USER, existing: { expiresAt: '2027-01-01T00:00:00.000Z' } });
    expect(values).toEqual({ expiresAt: null });
  });

  describe('password', () => {
    it('empty keeps it (password fields are never filled in)', async () => {
      expect((await update({ password: '' })).values).toEqual({});
    });

    it.each([['1'], ['true'], [true]])('removePassword=%p removes it', async (flag) => {
      expect((await update({ removePassword: flag, password: 'ignored' })).values).toEqual({ password: null });
    });

    it('null removes it', async () => {
      expect((await update({ password: null })).values).toEqual({ password: null });
    });

    it('a new one replaces it', async () => {
      const { values } = await update({ password: 'new one' });
      expect(await bcrypt.compare('new one', values.password)).toBe(true);
    });
  });
});

describe('invalid values', () => {
  it.each([
    [{ expiresAt: 'next tuesday' }, /expiry/i],
    [{ activateDateTime: '2027-13-45T99:00' }, /activation/i],
    [{ deactivateAt: 'soon' }, /deactivation/i],
    [{ expirationDays: '-2' }, /days/i],
    [{ expirationDays: 'abc' }, /days/i],
    [{ maxViews: '0' }, /limit/i],
    [{ maxViews: '-1' }, /limit/i],
    [{ maxViews: '1.5' }, /limit/i],
    [{ maxViews: 'many' }, /limit/i]
  ])('%p is refused', async (body, message) => {
    await expect(readSettings('paste', body, { user: USER })).rejects.toThrow(message);
    await expect(readSettings('paste', body, { user: USER })).rejects.toBeInstanceOf(SettingsError);
  });
});

describe('which role-gated features the request uses', () => {
  it('on create: a password or any schedule date', async () => {
    expect((await readSettings('url', {}, { user: USER })).uses).toEqual({ passwordProtection: false, scheduling: false });
    expect((await readSettings('url', { password: 'x' }, { user: USER })).uses.passwordProtection).toBe(true);
    expect((await readSettings('url', { deactivateDateTime: '2027-01-01T00:00' }, { user: USER })).uses.scheduling).toBe(true);
  });

  it('on update: only newly set values count, removals never do', async () => {
    const existing = { activateAt: '2027-01-01T09:00:00.000Z', deactivateAt: null, password: 'h' };
    const uses = async (body) => (await readSettings('url', body, { user: USER, existing })).uses;

    expect(await uses({ activateDateTime: '2027-01-01T09:00' })).toEqual({ passwordProtection: false, scheduling: false });
    expect((await uses({ activateDateTime: '2027-02-01T09:00' })).scheduling).toBe(true);
    expect((await uses({ activateDateTime: '' })).scheduling).toBe(false);
    expect((await uses({ removePassword: true })).passwordProtection).toBe(false);
    expect((await uses({ password: 'new' })).passwordProtection).toBe(true);
  });
});
