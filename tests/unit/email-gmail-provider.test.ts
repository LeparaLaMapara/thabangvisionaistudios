// @vitest-environment node
/**
 * Gmail / Nodemailer provider (D-79 / R-80, nodemailer 10.x).
 *
 * `nodemailer.createTransport` is mocked: the SMTP options the provider asks
 * for are captured, and the provider is handed a real in-memory
 * `streamTransport` (no network) carrying the same access policy, so the raw
 * RFC 5322 output can be asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type SentMessage = Record<string, unknown>;

const captured: {
  transportOptions: Record<string, unknown>[];
  messages: SentMessage[];
  raw: string[];
} = { transportOptions: [], messages: [], raw: [] };

vi.mock('nodemailer', async (importOriginal) => {
  const real = (await importOriginal()) as { default: typeof import('nodemailer') };
  const createTransport = vi.fn((options: Record<string, unknown>) => {
    captured.transportOptions.push(options);
    const stream = real.default.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'unix',
      disableFileAccess: options.disableFileAccess === true,
      disableUrlAccess: options.disableUrlAccess === true,
    });
    return {
      sendMail: async (message: SentMessage) => {
        captured.messages.push(message);
        const info = await stream.sendMail(message);
        captured.raw.push((info.message as Buffer).toString('utf8'));
        return info;
      },
    };
  });
  return { default: { ...real.default, createTransport } };
});

const STUDIO_ADDRESS = 'studio-test@example.com';

async function loadProvider() {
  vi.resetModules();
  const mod = await import('@/lib/email/gmail');
  return mod;
}

/** Header block of a raw message, with folded lines unfolded. */
function headersOf(raw: string): string {
  return raw.split('\n\n')[0].replace(/\n[ \t]+/g, ' ');
}

beforeEach(() => {
  captured.transportOptions.length = 0;
  captured.messages.length = 0;
  captured.raw.length = 0;
  vi.stubEnv('GMAIL_USER', STUDIO_ADDRESS);
  vi.stubEnv('GMAIL_APP_PASSWORD', 'abcd efgh ijkl mnop');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('gmail provider: transport', () => {
  it('uses Gmail SMTP over STARTTLS with file and URL access disabled', async () => {
    const { gmail } = await loadProvider();
    await gmail.sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' });

    expect(captured.transportOptions).toHaveLength(1);
    expect(captured.transportOptions[0]).toMatchObject({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      disableFileAccess: true,
      disableUrlAccess: true,
      auth: { user: STUDIO_ADDRESS, pass: 'abcd efgh ijkl mnop' },
    });
  });

  it('does not send (and does not build a transport) when unconfigured', async () => {
    vi.stubEnv('GMAIL_APP_PASSWORD', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { gmail } = await loadProvider();

    expect(gmail.isConfigured()).toBe(false);
    await gmail.sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' });

    expect(captured.transportOptions).toHaveLength(0);
    expect(captured.messages).toHaveLength(0);
    warn.mockRestore();
  });
});

describe('gmail provider: message shape', () => {
  it('sends from/to/subject/text/html as plain strings with no attachments', async () => {
    const { gmail } = await loadProvider();
    const { STUDIO } = await import('@/lib/constants');

    await gmail.sendEmail({
      to: 'user@example.com',
      subject: 'Booking Confirmed',
      text: 'Plain body',
      html: '<p>HTML body</p>',
    });

    expect(captured.messages).toHaveLength(1);
    const msg = captured.messages[0];
    expect(Object.keys(msg).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']);
    expect(msg.from).toEqual({ name: STUDIO.name, address: STUDIO_ADDRESS });
    expect(msg.to).toBe('user@example.com');
    expect(msg.subject).toBe('Booking Confirmed');
    expect(msg.text).toBe('Plain body');
    expect(msg.html).toBe('<p>HTML body</p>');
    expect(msg).not.toHaveProperty('attachments');

    const headers = headersOf(captured.raw[0]);
    expect(headers).toContain(`From: ${STUDIO.name} <${STUDIO_ADDRESS}>`);
    expect(headers).toContain('To: user@example.com');
    expect(headers).toContain('Subject: Booking Confirmed');
    expect(captured.raw[0]).toContain('multipart/alternative');
  });

  it('omits html when only text is given', async () => {
    const { gmail } = await loadProvider();
    await gmail.sendEmail({ to: 'user@example.com', subject: 'S', text: 'T' });
    expect(captured.messages[0]).not.toHaveProperty('html');
    expect(captured.raw[0]).toContain('Content-Type: text/plain');
  });

  it('builds the contact notification to the studio inbox with user text escaped', async () => {
    const { gmail } = await loadProvider();
    await gmail.sendContactNotification({
      name: '<script>alert(1)</script>',
      email: 'visitor@example.com',
      subject: 'Quote',
      message: 'line 1\nline 2',
    });

    const msg = captured.messages[0];
    expect(msg.to).toBe(STUDIO_ADDRESS);
    expect(msg.subject).toBe('[Contact] Quote');
    expect(msg.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('line 1<br />line 2');
    expect(msg).not.toHaveProperty('attachments');
  });
});

describe('gmail provider: header encoding', () => {
  it('MIME-encodes a non-ASCII subject', async () => {
    const { gmail } = await loadProvider();
    await gmail.sendEmail({ to: 'user@example.com', subject: 'Café — Booking', text: 'x' });

    const headers = headersOf(captured.raw[0]);
    expect(headers).toMatch(/Subject: =\?UTF-8\?[QB]\?/);
    expect(headers).not.toContain('Café');
  });

  it('cannot inject extra headers through a CR/LF in a user-influenced subject', async () => {
    const { gmail } = await loadProvider();
    await gmail.sendContactNotification({
      name: 'Visitor',
      email: 'visitor@example.com',
      subject: 'Hello\r\nBcc: victim@evil.test\r\nX-Injected: 1',
      message: 'm',
    });

    const headerLines = captured.raw[0].split('\n\n')[0].split('\n');
    expect(headerLines.some((l) => /^bcc:/i.test(l))).toBe(false);
    expect(headerLines.some((l) => /^x-injected:/i.test(l))).toBe(false);
  });

  it('cannot inject extra headers through a CR/LF in a recipient', async () => {
    const { gmail } = await loadProvider();
    await gmail
      .sendEmail({ to: 'user@example.com\r\nBcc: victim@evil.test', subject: 's', text: 't' })
      .catch(() => undefined);

    for (const raw of captured.raw) {
      const headerLines = raw.split('\n\n')[0].split('\n');
      expect(headerLines.some((l) => /^bcc:/i.test(l))).toBe(false);
    }
  });
});

describe('gmail provider: no file / URL content sources (resolveContent)', () => {
  const smuggled: Array<[string, unknown]> = [
    ['html as { path }', { path: '/etc/passwd' }],
    ['html as { href }', { href: 'http://169.254.169.254/latest/meta-data/' }],
  ];

  it.each(smuggled)('rejects %s before anything is sent', async (_label, html) => {
    const { gmail } = await loadProvider();
    await expect(
      gmail.sendEmail({ to: 'user@example.com', subject: 's', text: 't', html } as never),
    ).rejects.toThrow(/must be a string/);
    expect(captured.messages).toHaveLength(0);
  });

  it('rejects a text body given as a { path } object', async () => {
    const { gmail } = await loadProvider();
    await expect(
      gmail.sendEmail({ to: 'user@example.com', subject: 's', text: { path: '/etc/hosts' } } as never),
    ).rejects.toThrow(/must be a string/);
    expect(captured.messages).toHaveLength(0);
  });

  it('never forwards attachments, even if a caller smuggles them in', async () => {
    const { buildGmailMessage } = await loadProvider();
    const msg = buildGmailMessage(
      {
        to: 'user@example.com',
        subject: 's',
        text: 't',
        attachments: [{ path: '/etc/passwd' }],
      } as never,
      STUDIO_ADDRESS,
    );
    expect(msg).not.toHaveProperty('attachments');
  });

  it('treats path- and URL-looking user strings as literal text', async () => {
    const { gmail } = await loadProvider();
    await gmail.sendVerificationRejected({
      email: 'user@example.com',
      displayName: '/etc/passwd',
      reason: 'https://evil.test/x',
    });

    const raw = captured.raw[0];
    expect(raw).toContain('/etc/passwd');
    expect(raw).toContain('https://evil.test/x');
    expect(raw).not.toMatch(/root:.*:0:0:/);
  });

  it('the transport policy itself refuses path/href sources (defence in depth)', async () => {
    const { gmailTransportOptions } = await loadProvider();
    // Real (unmocked) stream transport built with the provider's own access policy.
    const real = (await vi.importActual<{ default: typeof import('nodemailer') }>('nodemailer')).default;
    const { disableFileAccess, disableUrlAccess } = gmailTransportOptions();
    const t = real.createTransport({
      streamTransport: true,
      buffer: true,
      disableFileAccess,
      disableUrlAccess,
    });

    await expect(
      t.sendMail({ from: STUDIO_ADDRESS, to: 'u@example.com', subject: 's', html: { path: '/etc/passwd' } }),
    ).rejects.toMatchObject({ code: 'EFILEACCESS' });
    await expect(
      t.sendMail({ from: STUDIO_ADDRESS, to: 'u@example.com', subject: 's', html: { href: 'http://127.0.0.1:1/' } }),
    ).rejects.toMatchObject({ code: 'EURLACCESS' });
    await expect(
      t.sendMail({
        from: STUDIO_ADDRESS,
        to: 'u@example.com',
        subject: 's',
        text: 't',
        attachments: [{ path: '/etc/passwd' }],
      }),
    ).rejects.toMatchObject({ code: 'EFILEACCESS' });
  });
});
