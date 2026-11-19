// The exercise library for workout plans (CF06): search, filters, details, names for a plan, and that a
// plan can only use library exercises. The library tables are a test copy of the real app tables
// (test/fixtures/proposed-app/0012). Synthetic data only.
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
let coach: { id: string; subject: string };

beforeAll(async () => {
  client = await connect();
  db = new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });
  const testAuth = await createTestAuth();
  keys = testAuth.keys;
  app = buildApp({ db, auth: testAuth.auth, onboarding: testOnboarding().deps });
  await app.ready();
  coach = await insertAccount(client, ['personal', 'coach']);
});
afterAll(async () => {
  await app.close();
  await db.end();
  await client.end();
});

async function get(url: string, subject = coach.subject) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await signToken(keys, subject)}` } });
}
const codesOf = (response: { json(): { exercises: { code: string }[] } }) => response.json().exercises.map((e) => e.code);

describe('exercise library', () => {
  it('lists exercises by name, with details when they exist and nulls when they do not', async () => {
    const body = (await get('/v1/exercises')).json();
    expect(body.total).toBe(5);
    expect(body.exercises.map((e: { code: string }) => e.code)).toEqual(['bench-press', 'goblet-squat', 'mystery-move', 'plank', 'push-up']);
    expect(body.exercises[0]).toMatchObject({ name: 'Bench Press', group: 'barbell', category: 'Barbell', primaryMuscle: 'Chest', equipment: 'Barbell', logType: 'weight_reps' });
    expect(body.exercises[2]).toMatchObject({ code: 'mystery-move', category: null, primaryMuscle: null, equipment: null });
  });

  it('searches the name and the aliases, matching % and _ literally', async () => {
    expect(codesOf(await get('/v1/exercises?q=squat'))).toEqual(['goblet-squat']);
    expect(codesOf(await get('/v1/exercises?q=press%20up'))).toEqual(['push-up']);
    expect((await get('/v1/exercises?q=%25')).json().total).toBe(0);
  });

  it('filters by category, muscle, equipment and group, and combines filters', async () => {
    expect(codesOf(await get('/v1/exercises?category=Core%20%2F%20Abs'))).toEqual(['plank']);
    expect(codesOf(await get('/v1/exercises?muscle=Chest'))).toEqual(['bench-press', 'push-up']);
    expect(codesOf(await get('/v1/exercises?equipment=Dumbbell'))).toEqual(['goblet-squat']);
    expect(codesOf(await get('/v1/exercises?group=bodyweight'))).toEqual(['plank', 'push-up']);
    expect(codesOf(await get('/v1/exercises?muscle=Chest&equipment=Barbell'))).toEqual(['bench-press']);
  });

  it('pages the results', async () => {
    const first = (await get('/v1/exercises?limit=2')).json();
    expect(first.exercises).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(codesOf(await get('/v1/exercises?limit=2&offset=4'))).toEqual(['push-up']);
    expect((await get('/v1/exercises?limit=0')).statusCode).toBe(400);
    expect((await get('/v1/exercises?offset=-1')).statusCode).toBe(400);
  });

  it('returns the filter options with counts', async () => {
    const body = (await get('/v1/exercises/filters')).json();
    expect(body.muscles).toContainEqual({ value: 'Chest', count: 2 });
    expect(body.categories.map((c: { value: string }) => c.value)).toContain('Core / Abs');
    expect(body.groups).toContainEqual({ value: 'bodyweight', count: 2 });
  });

  it('returns one exercise with steps, watch-for and video, and not found for an unknown code', async () => {
    const detail = (await get('/v1/exercises/bench-press')).json().exercise;
    expect(detail).toMatchObject({ steps: ['Lie flat', 'Press up'], watchFor: 'Keep your feet down', videoUrl: 'https://example.test/bench', musclesWorked: ['Triceps'] });
    expect((await get('/v1/exercises/mystery-move')).json().exercise).toMatchObject({ steps: [], watchFor: null, videoUrl: null });
    expect((await get('/v1/exercises/not-a-real-one')).statusCode).toBe(404);
  });

  it('gives names for the exercises of a plan in one call, leaving unknown codes out', async () => {
    expect(codesOf(await get('/v1/exercises?codes=plank,bench-press,nope')).sort()).toEqual(['bench-press', 'plank']);
    expect((await get('/v1/exercises?codes=bad%20code')).statusCode).toBe(400);
  });

  it('needs the Coach or Head Coach role', async () => {
    const trainee = await insertAccount(client, ['personal']);
    expect((await get('/v1/exercises', trainee.subject)).statusCode).toBe(403);
  });
});
