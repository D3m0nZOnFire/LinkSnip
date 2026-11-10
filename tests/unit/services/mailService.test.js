const mailService = require('../../../services/mailService');

// Sends LinkSnip's mails (address verification, password reset, notices). Off unless configured (config/env.js
// readMailConfig); links in mails always start with PUBLIC_URL, never with the address the request came in on.

const CONFIG = {
  transport: 'smtp',
  host: 'mail.example.com',
  port: 465,
  secure: true,
  user: 'no-reply@example.com',
  pass: 'secret',
  from: 'LinkSnip <no-reply@example.com>',
  replyTo: 'contact@example.com',
  publicUrl: 'https://links.example.com'
};

function fakeTransport() {
  return { sendMail: jest.fn(async () => ({ messageId: '<1@example.com>' })) };
}

afterEach(() => mailService.configure(null));

describe('mailService', () => {
  it('is off until configured', () => {
    mailService.configure(null);
    expect(mailService.isEnabled()).toBe(false);
    expect(() => mailService.link('/x')).toThrow(/not configured/);
  });

  it('summary() describes the setup for Admin → Settings, never the password', () => {
    expect(mailService.summary()).toBeNull();
    mailService.configure(CONFIG, { transport: fakeTransport() });
    expect(mailService.summary()).toEqual({
      transport: 'smtp', server: 'mail.example.com:465 (TLS)', from: 'LinkSnip <no-reply@example.com>',
      replyTo: 'contact@example.com', publicUrl: 'https://links.example.com'
    });
    expect(JSON.stringify(mailService.summary())).not.toContain('secret');
  });

  it('builds links from PUBLIC_URL', () => {
    mailService.configure(CONFIG, { transport: fakeTransport() });
    expect(mailService.isEnabled()).toBe(true);
    expect(mailService.link('/reset-password/abc')).toBe('https://links.example.com/reset-password/abc');
  });

  it('sends with the configured sender and Reply-To', async () => {
    const transport = fakeTransport();
    mailService.configure(CONFIG, { transport });
    await mailService.send({ to: 'ann@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'LinkSnip <no-reply@example.com>',
      replyTo: 'contact@example.com',
      to: 'ann@example.com',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>'
    });
  });

  it('leaves Reply-To out when none is set', async () => {
    const transport = fakeTransport();
    mailService.configure({ ...CONFIG, replyTo: null }, { transport });
    await mailService.send({ to: 'ann@example.com', subject: 'Hi', text: 'Hello' });
    expect(transport.sendMail.mock.calls[0][0]).not.toHaveProperty('replyTo');
  });

  it('passes extra headers (List-Unsubscribe) when given', async () => {
    const transport = fakeTransport();
    mailService.configure(CONFIG, { transport });
    const headers = { 'List-Unsubscribe': '<https://links.example.com/u>' };
    await mailService.send({ to: 'ann@example.com', subject: 'Hi', text: 'Hello', headers });
    expect(transport.sendMail.mock.calls[0][0].headers).toEqual(headers);
    await mailService.send({ to: 'ann@example.com', subject: 'Hi', text: 'Hello' });
    expect(transport.sendMail.mock.calls[1][0]).not.toHaveProperty('headers');
  });

  it('send rejects when mail is off or the server fails', async () => {
    await expect(mailService.send({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(/not configured/);
    const transport = { sendMail: jest.fn(async () => { throw new Error('connection refused'); }) };
    mailService.configure(CONFIG, { transport });
    await expect(mailService.send({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow('connection refused');
  });

  describe('deliver (in the background, for requests)', () => {
    it('hands the mail to the transport right away and resolves true', async () => {
      const transport = fakeTransport();
      mailService.configure(CONFIG, { transport });
      const done = mailService.deliver({ to: 'a@example.com', subject: 's', text: 't' });
      expect(transport.sendMail).toHaveBeenCalledTimes(1); // before anything is awaited
      await expect(done).resolves.toBe(true);
    });

    it('never rejects: a failure is logged without the message body', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      mailService.configure(CONFIG, { transport: { sendMail: jest.fn(async () => { throw new Error('boom'); }) } });
      await expect(mailService.deliver({ to: 'a@example.com', subject: 'Reset', text: 'secret-link' })).resolves.toBe(false);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
      expect(JSON.stringify(error.mock.calls)).not.toContain('secret-link');
      error.mockRestore();
    });

    it('resolves false when mail is off', async () => {
      await expect(mailService.deliver({ to: 'a@example.com', subject: 's', text: 't' })).resolves.toBe(false);
    });
  });

  it('the console transport prints the mail instead of sending it', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    mailService.configure({ transport: 'console', from: 'LinkSnip <no-reply@localhost>', replyTo: null, publicUrl: 'http://localhost:8081' });
    await mailService.send({ to: 'ann@example.com', subject: 'Verify', text: 'Open http://localhost:8081/x' });
    const printed = log.mock.calls.flat().join('\n');
    expect(printed).toContain('ann@example.com');
    expect(printed).toContain('Verify');
    expect(printed).toContain('http://localhost:8081/x');
    log.mockRestore();
  });
});
