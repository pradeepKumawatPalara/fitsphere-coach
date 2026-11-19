// The "you were added" email (C-D31): the text, and that it holds no credentials.
import { describe, expect, it } from 'vitest';
import { clientAddedEmail } from './mailer.ts';
import type { Settings } from './settings.ts';

const settings = { senderDisplayName: 'FitSphere Coach', senderEmail: 'sender@example.test' } as Settings;

describe('clientAddedEmail', () => {
  it('asks a person with no account to sign up with the same email', () => {
    const mail = clientAddedEmail(settings, { clientEmail: 'priya@example.test', clientName: 'Priya Nair', gymName: 'Iron Gym', waiting: true });
    expect(mail).toMatchObject({ to: 'priya@example.test', subject: 'Iron Gym added you on FitSphere', fromAddress: 'sender@example.test' });
    expect(mail.text).toContain('create an account with this email address (priya@example.test)');
    expect(mail.text).toContain('Hi Priya Nair,');
  });
  it('asks a person with an account to log in', () => {
    const mail = clientAddedEmail(settings, { clientEmail: 'priya@example.test', clientName: 'Priya', gymName: 'Iron Gym', waiting: false });
    expect(mail.text).toContain('log in with this email address');
  });
  it('never contains a password or credentials', () => {
    for (const waiting of [true, false]) {
      expect(clientAddedEmail(settings, { clientEmail: 'a@b.co', clientName: 'A B', gymName: 'Gym', waiting }).text).not.toMatch(/password|credential/i);
    }
  });
});
