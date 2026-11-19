import pg from 'pg';
import { buildApp } from './app.ts';
import { createSupabaseAuth } from './auth.ts';
import { createGmailMailer } from './mailer.ts';
import { loadSettings, SettingsError } from './settings.ts';

// Settings from apps/api/.env (runbook, "Configuration names"). A missing or out-of-range value
// stops the server and names the variable, never its value (ADR-0008, DC-5).
const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] as const;
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing in apps/api/.env: ${missing.join(', ')}`);
  process.exit(1);
}

let settings;
try {
  settings = loadSettings(process.env);
} catch (error) {
  console.error(error instanceof SettingsError ? `${error.message}\nSee apps/api/.env.example.` : 'Settings could not be read.');
  process.exit(1);
}

// Local testing without Gmail: LOCAL_TEST_APPROVAL_CODE skips the approval email and makes every
// request use that fixed code. Refused in production, and the code must fit the configured length.
const localCode = process.env.LOCAL_TEST_APPROVAL_CODE;
if (localCode) {
  if (process.env.NODE_ENV === 'production' || !/^[0-9]+$/.test(localCode) || localCode.length !== settings.approvalCodeLength) {
    console.error(`LOCAL_TEST_APPROVAL_CODE must be ${settings.approvalCodeLength} digits and cannot be used in production.`);
    process.exit(1);
  }
  console.warn('LOCAL TEST MODE: no approval email is sent and the approval code is fixed. Never use this for real gyms.');
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
// An idle connection that drops (e.g. the Supabase project pauses) must not stop the API.
db.on('error', () => {});

const app = buildApp({
  db,
  auth: createSupabaseAuth({
    supabaseUrl: process.env.SUPABASE_URL!,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
  }),
  onboarding: {
    settings,
    // Local test mode sends nothing: it prints the email to this console so you can see what would be sent.
    mailer: localCode
      ? {
          send: async (email) => {
            console.log(`LOCAL TEST MODE: email not sent.
To: ${email.to}
Subject: ${email.subject}
${email.text}
---`);
          },
        }
      : createGmailMailer({ user: settings.senderEmail, appPassword: settings.smtpAppPassword }),
    ...(localCode ? { fixedCode: localCode } : {}),
  },
  log: { level: process.env.LOG_LEVEL ?? 'info' },
});

// Port 3100 by default, so the trainee API (3000) and this one can run on one PC. Loopback only,
// unless HOST is set for testing on a phone on the same Wi-Fi (runbook §4).
const port = Number(process.env.PORT ?? '3100');
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
