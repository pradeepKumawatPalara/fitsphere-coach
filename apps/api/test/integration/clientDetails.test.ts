// Edit client and a client's exercises (CF04, C-D31 proposed). Local test database only; the exercise
// library tables are the test copy (test/fixtures/proposed-app/0012). Synthetic data only.
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

beforeAll(async () => {
  client = await connect();
  db = new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });
  const testAuth = await createTestAuth();
  keys = testAuth.keys;
  app = buildApp({ db, auth: testAuth.auth, onboarding: testOnboarding().deps });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.end();
  await client.end();
});

async function call(method: 'GET' | 'PUT', url: string, subject: string, payload?: object) {
  const token = await signToken(keys, subject);
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}

async function link(upper: string, lower: string, kind = 'coach_trainee') {
  await client.query(`insert into app.links (kind, upper_user_id, lower_user_id, status, started_at) values ($1, $2, $3, 'active', now())`, [kind, upper, lower]);
}

/** A gym with a Head Coach, two Coaches, and a client under each Coach. */
async function gym() {
  const head = await insertAccount(client, ['personal', 'head_coach']);
  const ravi = await insertAccount(client, ['personal', 'coach']);
  const meera = await insertAccount(client, ['personal', 'coach']);
  const underRavi = await insertAccount(client, ['personal']);
  const underMeera = await insertAccount(client, ['personal']);
  await client.query('insert into coach.profiles (user_id, full_name) values ($1, $2), ($3, $4), ($5, $6)', [head.id, 'Asha Rao', ravi.id, 'Ravi Kumar', meera.id, 'Meera Joshi']);
  await link(head.id, ravi.id, 'head_coach_coach');
  await link(head.id, meera.id, 'head_coach_coach');
  await link(ravi.id, underRavi.id);
  await link(meera.id, underMeera.id);
  await client.query(
    `insert into coach.gyms (head_coach_id, name, address, city, pincode, owner_phone, total_trainees) values ($1, 'Iron Gym', 'a', 'b', '123456', '+919999999999', 10)`,
    [head.id],
  );
  return { head, ravi, meera, underRavi, underMeera };
}

const body = { fullName: ' Priya Nair ', phone: '+91 98765 43210', fitnessGoal: 'weight_loss', notes: '  Mild knee pain  ' };

describe('editing a client', () => {
  it('a Coach edits their own client: saved in coach.gym_clients, and shown on the profile', async () => {
    const g = await gym();
    expect((await call('PUT', `/v1/clients/${g.underRavi.id}`, g.ravi.subject, body)).statusCode).toBe(204);
    const row = (await client.query('select * from coach.gym_clients where client_id = $1', [g.underRavi.id])).rows[0];
    expect(row).toMatchObject({ full_name: 'Priya Nair', phone: '+91 98765 43210', fitness_goal: 'weight_loss', notes: 'Mild knee pain', gym_head_coach_id: g.head.id, updated_by: g.ravi.id });
    const profile = (await call('GET', `/v1/clients/${g.underRavi.id}`, g.ravi.subject)).json();
    expect(profile).toMatchObject({ name: 'Priya Nair', phone: '+91 98765 43210', fitnessGoal: 'weight_loss', notes: 'Mild knee pain' });
    expect(profile.email).toBe(g.underRavi.email);
  });

  it('editing again updates the same row; the Head Coach may edit any client of the gym', async () => {
    const g = await gym();
    await call('PUT', `/v1/clients/${g.underMeera.id}`, g.meera.subject, body);
    expect((await call('PUT', `/v1/clients/${g.underMeera.id}`, g.head.subject, { ...body, fullName: 'Priya N', phone: null, fitnessGoal: null, notes: '' })).statusCode).toBe(204);
    const rows = (await client.query('select * from coach.gym_clients where client_id = $1', [g.underMeera.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ full_name: 'Priya N', phone: null, fitness_goal: null, notes: null, updated_by: g.head.id });
  });

  it('a Coach cannot edit someone else\'s client: not found, nothing saved', async () => {
    const g = await gym();
    expect((await call('PUT', `/v1/clients/${g.underMeera.id}`, g.ravi.subject, body)).statusCode).toBe(404);
    expect((await client.query('select 1 from coach.gym_clients where client_id = $1', [g.underMeera.id])).rowCount).toBe(0);
  });

  it('refuses a bad name, phone, goal or an unknown field', async () => {
    const g = await gym();
    const put = (payload: object) => call('PUT', `/v1/clients/${g.underRavi.id}`, g.ravi.subject, payload).then((r) => r.statusCode);
    expect(await put({ ...body, fullName: 'P' })).toBe(400);
    expect(await put({ ...body, phone: 'abc' })).toBe(400);
    expect(await put({ ...body, fitnessGoal: 'flying' })).toBe(400);
    expect(await put({ ...body, email: 'x@y.co' })).toBe(400);
    expect(await put({ ...body, notes: 'x'.repeat(501) })).toBe(400);
  });
});

const content = (exerciseId: string) => ({
  weeks: 8,
  scheduleMode: 'weekdays',
  weeklyTarget: null,
  dailyTarget: false,
  days: [
    { name: 'Push', weekday: 1, rest: false, exercises: [{ exerciseId, group: null, sets: 4, repsMin: 8, repsMax: 10, weightG: 60000, rpe: 8, restS: 120, note: 'Pause' }] },
    { name: 'Rest', weekday: 2, rest: true, exercises: [] },
  ],
});
async function plan(g: Awaited<ReturnType<typeof gym>>, traineeId: string, status: 'draft' | 'active', exerciseId = 'bench-press') {
  await client.query(
    `insert into coach.training_plans (id, trainee_id, gym_head_coach_id, created_by, name, status, start_date, content, version, live_version, published_at)
     values ($1, $2, $3, $3, 'Push Pull', $4, current_date, $5, 1, $6, $7)`,
    [randomUUID(), traineeId, g.head.id, status, JSON.stringify(content(exerciseId)), status === 'active' ? 1 : null, status === 'active' ? new Date() : null],
  );
}

describe('a client\'s exercises', () => {
  it('shows the live plan with each exercise\'s library details, and what the client logged', async () => {
    const g = await gym();
    await plan(g, g.underRavi.id, 'active');
    await client.query(
      `insert into app.workouts (user_id, id, day, exercises, recorded_at) values ($1, $2, '2026-11-10', $3, now()), ($1, $4, '2026-11-09', '[]', now())`,
      [g.underRavi.id, randomUUID(), JSON.stringify([{ name: 'Squat', sets: 3, reps: 10, weightGrams: 50000, note: 'felt good' }, { notes: 'no name' }]), randomUUID()],
    );
    const result = (await call('GET', `/v1/clients/${g.underRavi.id}/exercises`, g.ravi.subject)).json();
    expect(result.plan).toMatchObject({ name: 'Push Pull', status: 'active', weeks: 8 });
    const first = result.plan.days[0].exercises[0];
    expect(first).toMatchObject({ exerciseId: 'bench-press', name: 'Bench Press', sets: 4, weightG: 60000, note: 'Pause' });
    expect(first.detail).toMatchObject({ steps: ['Lie flat', 'Press up'], watchFor: 'Keep your feet down', videoUrl: 'https://example.test/bench', primaryMuscle: 'Chest' });
    expect(result.plan.days[1]).toMatchObject({ rest: true, exercises: [] });
    expect(result.recent).toEqual([
      { day: '2026-11-10', exercises: [{ name: 'Squat', sets: 3, reps: 10, weightG: 50000, note: 'felt good' }] },
      { day: '2026-11-09', exercises: [] },
    ]);
  });

  it('shows the draft when nothing is live, and the code when the exercise is no longer in the library', async () => {
    const g = await gym();
    await plan(g, g.underRavi.id, 'draft', 'gone-from-library');
    const result = (await call('GET', `/v1/clients/${g.underRavi.id}/exercises`, g.head.subject)).json();
    expect(result.plan.status).toBe('draft');
    expect(result.plan.days[0].exercises[0]).toMatchObject({ name: 'gone-from-library', detail: null });
  });

  it('has no plan and no logs for a new client, and hides another coach\'s client', async () => {
    const g = await gym();
    expect((await call('GET', `/v1/clients/${g.underRavi.id}/exercises`, g.ravi.subject)).json()).toEqual({ plan: null, recent: [] });
    expect((await call('GET', `/v1/clients/${g.underMeera.id}/exercises`, g.ravi.subject)).statusCode).toBe(404);
  });
});

const mealItems = (name: string) => JSON.stringify([{ name, amount: { value: 100, unit: 'g' }, kcal: 300, proteinG: 20, carbsG: 30, fatG: 10, estimated: false, source: 'barcode' }, 'junk', { nope: 1 }]);
async function meal(userId: string, day: string, type: string, kcal: number, photo: object | null = null, name = 'Oats', recordedAt = new Date().toISOString()) {
  await client.query(
    `insert into app.meals (user_id, id, day, meal_type, tags, items, kcal, protein_g, carbs_g, fat_g, recorded_at, photo)
     values ($1, $2, $3, $4, '{}', $5, $6, 20, 30, 10, $7, $8)`,
    [userId, randomUUID(), day, type, mealItems(name), kcal, recordedAt, photo ? JSON.stringify(photo) : null],
  );
}

describe('a client\'s food log (read from the FitSphere app)', () => {
  const get = async (subject: string, id: string, query = '') => {
    const token = await signToken(keys, subject);
    return app.inject({ method: 'GET', url: `/v1/clients/${id}/nutrition${query}`, headers: { authorization: `Bearer ${token}` } });
  };

  it('shows the day\'s meals with their foods, totals, the target in force, and the last 7 days', async () => {
    const g = await gym();
    const day = '2026-11-12';
    await meal(g.underRavi.id, day, 'breakfast', 300, null, 'Oats', '2026-11-12T02:40:00Z');
    await meal(g.underRavi.id, day, 'lunch', 500, { kind: 'link', url: 'https://example.test/p' }, 'Rice', '2026-11-12T07:50:00Z');
    await meal(g.underRavi.id, day, 'dinner', 400, { kind: 'photo', mediaId: randomUUID() }, 'Dal', '2026-11-12T14:00:00Z');
    await meal(g.underRavi.id, '2026-11-10', 'lunch', 700);
    await client.query(`insert into app.targets (user_id, kind, value, set_at, day) values ($1, 'calories', 1800, now(), '2026-11-01'), ($1, 'calories', 2000, now(), '2026-11-20'), ($1, 'protein', 110, now(), '2026-11-01')`, [g.underRavi.id]);
    const body = (await get(g.ravi.subject, g.underRavi.id, `?day=${day}`)).json();
    expect(body.day).toBe(day);
    expect(body.meals.map((m: { mealType: string }) => m.mealType)).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(body.meals[0].items).toEqual([{ name: 'Oats', amount: { value: 100, unit: 'g' }, kcal: 300, proteinG: 20, carbsG: 30, fatG: 10, estimated: false }]);
    expect(body.meals[1].photo).toEqual({ kind: 'link', url: 'https://example.test/p' });
    expect(body.meals[2].photo).toEqual({ kind: 'stored' });
    expect(body.totals).toMatchObject({ kcal: 1200, proteinG: 60, carbsG: 90, fatG: 30 });
    expect(body.targets).toMatchObject({ kcal: 1800, proteinG: 110, carbsG: null });
    expect(body.week).toEqual([{ day, kcal: 1200, meals: 3 }, { day: '2026-11-10', kcal: 700, meals: 1 }]);
  });

  it('leaves out deleted meals, and answers an empty day with zero totals', async () => {
    const g = await gym();
    await meal(g.underRavi.id, '2026-11-12', 'lunch', 500);
    await client.query(`update app.meals set deleted_at = now(), items = null, photo = null where user_id = $1`, [g.underRavi.id]);
    const body = (await get(g.head.subject, g.underRavi.id, '?day=2026-11-12')).json();
    expect(body.meals).toEqual([]);
    expect(body.totals.kcal).toBe(0);
    expect(body.week).toEqual([]);
  });

  it('a public photo link that is not http(s) is not passed on', async () => {
    const g = await gym();
    await meal(g.underRavi.id, '2026-11-12', 'lunch', 500, { kind: 'link', url: 'javascript:alert(1)' });
    expect((await get(g.ravi.subject, g.underRavi.id, '?day=2026-11-12')).json().meals[0].photo).toBeNull();
  });

  it('a Coach cannot see another coach\'s client; the Head Coach sees any client of the gym', async () => {
    const g = await gym();
    await meal(g.underMeera.id, '2026-11-12', 'lunch', 500);
    expect((await get(g.ravi.subject, g.underMeera.id, '?day=2026-11-12')).statusCode).toBe(404);
    expect((await get(g.head.subject, g.underMeera.id, '?day=2026-11-12')).json().meals).toHaveLength(1);
  });

  it('refuses a bad day and answers not found for a waiting client', async () => {
    const g = await gym();
    expect((await get(g.ravi.subject, g.underRavi.id, '?day=12-11-2026')).statusCode).toBe(400);
    expect((await get(g.ravi.subject, g.underRavi.id, '?day=2026-13-45')).statusCode).toBe(400);
    expect((await get(g.ravi.subject, randomUUID())).statusCode).toBe(404);
  });
});
