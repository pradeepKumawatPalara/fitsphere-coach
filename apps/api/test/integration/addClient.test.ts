// The Gym Owner adds a client directly (CF04, C-D31 proposed). The client must already have a FitSphere
// account (they sign up in the FitSphere app first); this repo never creates sign-in accounts.
// Local test database only. Synthetic data only.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createTestAuth, signToken, type TestKeys } from '../helpers/auth.ts';
import { testOnboarding } from '../helpers/onboarding.ts';
import { connect, insertAccount, testDatabaseUrl } from './database.ts';

let client: pg.Client;
let db: pg.Pool;
let keys: TestKeys;
let app: ReturnType<typeof buildApp>;
const on = testOnboarding();

beforeAll(async () => {
  client = await connect();
  db = new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });
  const testAuth = await createTestAuth();
  keys = testAuth.keys;
  app = buildApp({ db, auth: testAuth.auth, onboarding: on.deps });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.end();
  await client.end();
});

async function post(subject: string, payload: object) {
  const token = await signToken(keys, subject);
  return app.inject({ method: 'POST', url: '/v1/clients', headers: { authorization: `Bearer ${token}` }, payload });
}
async function list(subject: string) {
  const token = await signToken(keys, subject);
  return (await app.inject({ method: 'GET', url: '/v1/clients', headers: { authorization: `Bearer ${token}` } })).json();
}

/** A person who has signed up in the FitSphere app: an `app.users` row. */
async function signedUp() {
  const account = await insertAccount(client, ['personal']);
  return { id: account.id, email: account.email };
}

async function gym() {
  const head = await insertAccount(client, ['personal', 'head_coach']);
  const ravi = await insertAccount(client, ['personal', 'coach']);
  await client.query('insert into coach.profiles (user_id, full_name) values ($1, $2), ($3, $4)', [head.id, 'Asha Rao', ravi.id, 'Ravi Kumar']);
  await client.query(
    `insert into app.links (kind, upper_user_id, lower_user_id, status, started_at) values ('head_coach_coach', $1, $2, 'active', now())`,
    [head.id, ravi.id],
  );
  await client.query(
    `insert into coach.gyms (head_coach_id, name, address, city, pincode, owner_phone, total_trainees) values ($1, 'Iron Gym', 'a', 'b', '123456', '+919999999999', 10)`,
    [head.id],
  );
  return { head, ravi };
}

describe('adding a client directly', () => {
  it('links a signed-up user: marks them as a gym member, links them and shows them in the list by name', async () => {
    const g = await gym();
    const person = await signedUp();
    const response = await post(g.head.subject, { email: `  ${person.email.toUpperCase()} `, fullName: ' Priya Nair ' });
    expect(response.statusCode).toBe(201);
    expect(response.json().client.id).toBe(person.id);

    const row = (await client.query('select * from coach.gym_clients where client_id = $1', [person.id])).rows[0];
    expect(row).toMatchObject({ gym_head_coach_id: g.head.id, added_by: g.head.id, full_name: 'Priya Nair', is_gym_member: true });
    const link = await client.query(`select upper_user_id from app.links where kind = 'coach_trainee' and status = 'active' and lower_user_id = $1`, [person.id]);
    expect(link.rows[0].upper_user_id).toBe(g.head.id);

    const body = await list(g.head.subject);
    expect(body.canAdd).toBe(true);
    expect(body.clients.map((c: { name: string }) => c.name)).toContain('Priya Nair');
  });

  it('an email with no FitSphere account waits, and nothing is created in app.users', async () => {
    const g = await gym();
    const email = `nobody-${randomUUID()}@example.test`;
    const response = await post(g.head.subject, { email: `  ${email.toUpperCase()} `, fullName: ' Waiting Wendy ' });
    expect(response.statusCode).toBe(201);
    const id = response.json().client.id as string;
    expect(response.json().client.waiting).toBe(true);
    expect((await client.query('select 1 from app.users where email = $1', [email])).rowCount).toBe(0);
    expect((await client.query('select * from coach.waiting_clients where id = $1', [id])).rows[0]).toMatchObject({
      email,
      full_name: 'Waiting Wendy',
      gym_head_coach_id: g.head.id,
      coach_id: g.head.id,
    });
    const body = await list(g.head.subject);
    const row = body.clients.find((c: { id: string }) => c.id === id);
    expect(row).toMatchObject({ name: 'Waiting Wendy', waiting: true });
  });

  it('a second add of a waiting email is refused; another gym is not told where', async () => {
    const g = await gym();
    const other = await gym();
    const email = `nobody-${randomUUID()}@example.test`;
    expect((await post(g.head.subject, { email, fullName: 'Waiting Wendy' })).statusCode).toBe(201);
    const again = await post(g.head.subject, { email, fullName: 'Waiting Wendy' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_ADDED');
    const elsewhere = await post(other.head.subject, { email, fullName: 'Waiting Wendy' });
    expect(elsewhere.statusCode).toBe(409);
    expect(elsewhere.json().error.code).toBe('CLIENT_UNAVAILABLE');
  });

  it('links a waiting client when their account appears: gym row, link under the chosen Coach, waiting row gone', async () => {
    const g = await gym();
    const email = `later-${randomUUID()}@example.test`;
    const id = (await post(g.head.subject, { email, fullName: 'Later Lena', coachId: g.ravi.id })).json().client.id as string;
    // The person signs up in the FitSphere app: the trainee API creates their app.users row.
    const created = await client.query(
      `insert into app.users (auth_subject, email, age_confirmed_at, age_confirmation_text_version) values ($1, $2, now(), 'synthetic') returning id`,
      [randomUUID(), email],
    );
    const userId = created.rows[0].id as string;
    const body = await list(g.head.subject);
    expect(body.clients.find((c: { id: string }) => c.id === id)).toBeUndefined();
    expect(body.clients.find((c: { id: string }) => c.id === userId)).toMatchObject({ name: 'Later Lena', coachId: g.ravi.id });
    expect((await client.query('select 1 from coach.waiting_clients where id = $1', [id])).rowCount).toBe(0);
    expect((await client.query('select full_name, is_gym_member from coach.gym_clients where client_id = $1', [userId])).rows[0]).toMatchObject({ full_name: 'Later Lena', is_gym_member: true });
    expect((await client.query('select is_gym_member from app.users where id = $1', [userId])).rows[0].is_gym_member).toBe(true);
    const asRavi = await list(g.ravi.subject);
    expect(asRavi.clients.map((c: { id: string }) => c.id)).toContain(userId);
  });

  it('a person already a client elsewhere stays waiting and is not linked', async () => {
    const g = await gym();
    const other = await gym();
    const email = `busy-${randomUUID()}@example.test`;
    const id = (await post(g.head.subject, { email, fullName: 'Busy Bella' })).json().client.id as string;
    const created = await client.query(
      `insert into app.users (auth_subject, email, age_confirmed_at, age_confirmation_text_version) values ($1, $2, now(), 'synthetic') returning id`,
      [randomUUID(), email],
    );
    await client.query(`insert into app.links (kind, upper_user_id, lower_user_id, status, started_at) values ('coach_trainee', $1, $2, 'active', now())`, [other.head.id, created.rows[0].id]);
    const body = await list(g.head.subject);
    expect(body.clients.find((c: { id: string }) => c.id === id)).toMatchObject({ waiting: true });
    expect((await client.query('select 1 from coach.waiting_clients where id = $1', [id])).rowCount).toBe(1);
  });

  it('a Coach sees only their own waiting clients; the Head Coach edits, moves and cancels them', async () => {
    const g = await gym();
    const mine = (await post(g.head.subject, { email: `m-${randomUUID()}@example.test`, fullName: 'Under Ravi', coachId: g.ravi.id })).json().client.id as string;
    const notMine = (await post(g.head.subject, { email: `n-${randomUUID()}@example.test`, fullName: 'Under Head' })).json().client.id as string;
    const ids = (await list(g.ravi.subject)).clients.map((c: { id: string }) => c.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(notMine);
    const token = await signToken(keys, g.head.subject);
    const call = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
    expect((await call('GET', `/v1/clients/${mine}`)).json()).toMatchObject({ waiting: true, name: 'Under Ravi', isGymMember: false });
    expect((await call('PUT', `/v1/clients/${mine}`, { fullName: 'Renamed', phone: '+91 98765 43210', fitnessGoal: 'strength', notes: 'Note' })).statusCode).toBe(204);
    expect((await call('GET', `/v1/clients/${mine}`)).json()).toMatchObject({ name: 'Renamed', phone: '+91 98765 43210', fitnessGoal: 'strength', notes: 'Note' });
    expect((await call('POST', `/v1/clients/${mine}/move`, { coachId: g.head.id })).statusCode).toBe(204);
    expect((await client.query('select coach_id from coach.waiting_clients where id = $1', [mine])).rows[0].coach_id).toBe(g.head.id);
    expect((await call('GET', `/v1/clients/${mine}/exercises`)).statusCode).toBe(404);
    expect((await call('POST', `/v1/clients/${mine}/remove`, {})).statusCode).toBe(204);
    expect((await client.query('select 1 from coach.waiting_clients where id = $1', [mine])).rowCount).toBe(0);
    // A Coach cannot open, edit or cancel a waiting client that is not theirs.
    const ravi = await signToken(keys, g.ravi.subject);
    expect((await app.inject({ method: 'GET', url: `/v1/clients/${notMine}`, headers: { authorization: `Bearer ${ravi}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/clients/${notMine}/remove`, headers: { authorization: `Bearer ${ravi}` }, payload: {} })).statusCode).toBe(404);
  });

  it('the Head Coach can add under a Coach of the gym; a second add is refused', async () => {
    const g = await gym();
    const person = await signedUp();
    expect((await post(g.head.subject, { email: person.email, fullName: 'Arjun Das', coachId: g.ravi.id })).statusCode).toBe(201);
    const again = await post(g.head.subject, { email: person.email, fullName: 'Arjun Das' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_ADDED');
    const asRavi = await list(g.ravi.subject);
    expect(asRavi.clients.map((c: { name: string }) => c.name)).toContain('Arjun Das');
    expect(asRavi.canAdd).toBe(false);
  });

  it('a person already a client of another gym is refused without revealing where', async () => {
    const g = await gym();
    const other = await gym();
    const person = await signedUp();
    expect((await post(other.head.subject, { email: person.email, fullName: 'Taken' })).statusCode).toBe(201);
    const response = await post(g.head.subject, { email: person.email, fullName: 'Taken' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CLIENT_UNAVAILABLE');
  });

  it('a Coach cannot add a client; a Coach of the gym cannot be a client; a coach outside the gym is refused', async () => {
    const g = await gym();
    const person = await signedUp();
    expect((await post(g.ravi.subject, { email: person.email, fullName: 'Someone' })).statusCode).toBe(403);
    const ravisEmail = (await client.query('select email from app.users where id = $1', [g.ravi.id])).rows[0].email as string;
    expect((await post(g.head.subject, { email: ravisEmail, fullName: 'Ravi Kumar' })).statusCode).toBe(409);
    const outsider = await insertAccount(client, ['personal', 'coach']);
    expect((await post(g.head.subject, { email: person.email, fullName: 'Someone', coachId: outsider.id })).statusCode).toBe(400);
  });

  it('refuses a bad name or email', async () => {
    const g = await gym();
    expect((await post(g.head.subject, { email: 'nope', fullName: 'A' })).statusCode).toBe(400);
  });
});

describe('people open to joining a gym (TCR-007)', () => {
  async function available(subject: string, query = '') {
    const token = await signToken(keys, subject);
    return app.inject({ method: 'GET', url: `/v1/clients/available${query}`, headers: { authorization: `Bearer ${token}` } });
  }
  const optIn = async (id: string, on = true) => client.query('update app.users set open_to_gym = $2 where id = $1', [id, on]);

  it('lists only people who opted in, by email, and leaves out people already in a gym', async () => {
    const g = await gym();
    const open = await signedUp();
    const closed = await signedUp();
    const taken = await signedUp();
    await optIn(open.id);
    await optIn(taken.id);
    await post(g.head.subject, { email: taken.email, fullName: 'Taken Person' });
    const body = (await available(g.head.subject)).json();
    expect(body.enabled).toBe(true);
    const emails = body.people.map((p: { email: string }) => p.email);
    expect(emails).toContain(open.email);
    expect(emails).not.toContain(closed.email);
    expect(emails).not.toContain(taken.email);
    expect(body.people.every((p: object) => Object.keys(p).sort().join() === 'email,id')).toBe(true);
  });

  it('searches by email, matching % and _ literally', async () => {
    const g = await gym();
    const open = await signedUp();
    await optIn(open.id);
    const part = open.email.slice(5, 14);
    expect((await available(g.head.subject, `?q=${encodeURIComponent(part)}`)).json().people.map((p: { id: string }) => p.id)).toContain(open.id);
    expect((await available(g.head.subject, '?q=%25')).json().people).toEqual([]);
  });

  it('is empty and not enabled for a Coach', async () => {
    const g = await gym();
    const open = await signedUp();
    await optIn(open.id);
    expect((await available(g.ravi.subject)).json()).toEqual({ enabled: false, people: [] });
  });
});

describe('the trainee app\'s gym member flag (TCR-007, when the column exists)', () => {
  const flag = async (id: string) => (await client.query('select is_gym_member from app.users where id = $1', [id])).rows[0].is_gym_member as boolean;

  it('is set when a gym adds the person and cleared when they are removed', async () => {
    const g = await gym();
    const person = await signedUp();
    expect(await flag(person.id)).toBe(false);
    await post(g.head.subject, { email: person.email, fullName: 'Flag Person' });
    expect(await flag(person.id)).toBe(true);
    const token = await signToken(keys, g.head.subject);
    expect((await app.inject({ method: 'POST', url: `/v1/clients/${person.id}/remove`, headers: { authorization: `Bearer ${token}` }, payload: {} })).statusCode).toBe(204);
    expect(await flag(person.id)).toBe(false);
  });
});

describe('telling the client by email', () => {
  it('sends the "you were added" email after adding, with no credentials in it, and answers emailed: true', async () => {
    const g = await gym();
    const person = await signedUp();
    on.sent.length = 0;
    const response = await post(g.head.subject, { email: person.email, fullName: 'Priya Nair' });
    expect(response.statusCode).toBe(201);
    expect(response.json().emailed).toBe(true);
    expect(on.sent).toHaveLength(1);
    expect(on.sent[0]).toMatchObject({ to: person.email, subject: 'Iron Gym added you on FitSphere' });
    expect(on.sent[0]?.text).toContain('log in with this email address');
    expect(on.sent[0]?.text).not.toMatch(/password|credential/i);
  });

  it('tells a person with no account to sign up with that email', async () => {
    const g = await gym();
    const email = `new-${randomUUID()}@example.test`;
    on.sent.length = 0;
    await post(g.head.subject, { email, fullName: 'New Person' });
    expect(on.sent[0]?.text).toContain(`create an account with this email address (${email})`);
  });

  it('a failed email does not undo the add: 201 with emailed: false', async () => {
    const g = await gym();
    const email = `fail-${randomUUID()}@example.test`;
    on.failNextSend();
    const response = await post(g.head.subject, { email, fullName: 'Mail Fails' });
    expect(response.statusCode).toBe(201);
    expect(response.json().emailed).toBe(false);
    expect((await client.query('select 1 from coach.waiting_clients where email = $1', [email])).rowCount).toBe(1);
  });
});
