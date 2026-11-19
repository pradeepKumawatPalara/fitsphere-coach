// The food list for diet plans (CF07): search, groups, servings, and that a plan can use a food from the
// list. The tables are a test copy of the real app tables (test/fixtures/proposed-app/0014). Synthetic data only.
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
let coach: { id: string; subject: string };
const ids: Record<string, string> = {};

async function food(code: string, name: string, group: string, extra: { hidden?: boolean; review?: boolean; fibre?: number | null; aliases?: string[] } = {}) {
  const { rows } = await client.query(
    `insert into app.foods (source, code, name, food_group, protein_g, fibre_g, fat_g, carbs_g, kcal, kcal_source, estimated, needs_review, hidden, aliases)
     values ('indb', $1, $2, $3, 18.3, $4, 20.8, 1.2, 265, 'published', false, $5, $6, $7) returning id`,
    [code, name, group, extra.fibre === undefined ? 0.5 : extra.fibre, extra.review ?? false, extra.hidden ?? false, extra.aliases ?? []],
  );
  ids[code] = rows[0].id as string;
}

beforeAll(async () => {
  client = await connect();
  db = new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });
  const testAuth = await createTestAuth();
  keys = testAuth.keys;
  app = buildApp({ db, auth: testAuth.auth, onboarding: testOnboarding().deps });
  await app.ready();
  coach = await insertAccount(client, ['personal', 'coach']);
  await client.query(`delete from app.foods where source = 'indb' and code like 'T-%'`);
  await food('T-PANEER', 'Test paneer', 'Test milk', { aliases: ['cottage cheese'] });
  await food('T-PANEER-65', 'Test paneer 65', 'Test snacks', { fibre: null });
  await food('T-RICE', 'Test rice', 'Test cereals');
  await food('T-HIDDEN', 'Test hidden paneer', 'Test milk', { hidden: true });
  await food('T-REVIEW', 'Test review paneer', 'Test milk', { review: true });
  await client.query(`insert into app.food_portions (source, code, seq, label, grams) values ('indb', 'T-PANEER', 1, 'Slice', 25), ('indb', 'T-PANEER', 2, 'Plate', 120)`);
  await client.query(`insert into app.food_measures (source, code, measure, grams) values ('indb', 'T-PANEER', 'katori', 150)`);
});
afterAll(async () => {
  await client.query(`delete from app.foods where source = 'indb' and code like 'T-%'`);
  await app.close();
  await db.end();
  await client.end();
});

async function call(method: 'GET' | 'POST', url: string, payload?: object) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${await signToken(keys, coach.subject)}` }, ...(payload ? { payload } : {}) });
}
const names = (response: { json(): { foods: { name: string }[] } }) => response.json().foods.map((f) => f.name);

describe('food list', () => {
  it('searches by name and alias, leaves out hidden and unreviewed foods, and puts names that start with the text first', async () => {
    const found = await call('GET', '/v1/foods?q=paneer');
    expect(names(found)).toEqual(['Test paneer', 'Test paneer 65']);
    expect(names(await call('GET', '/v1/foods?q=cottage'))).toEqual(['Test paneer']);
    expect(names(await call('GET', '/v1/foods?q=65%25'))).toEqual([]);
  });

  it('gives values per 100 g, a missing fibre as 0, and servings from food_portions and food_measures', async () => {
    const body = (await call('GET', '/v1/foods?q=paneer')).json();
    expect(body.foods[0]).toMatchObject({ id: ids['T-PANEER'], group: 'Test milk', per100g: { kcal: 265, proteinG: 18.3, carbsG: 1.2, fatG: 20.8, fibreG: 0.5 } });
    expect(body.foods[0].portions).toEqual([{ label: 'Slice', grams: 25 }, { label: 'Plate', grams: 120 }, { label: '1 katori', grams: 150 }]);
    expect(body.foods[1].per100g.fibreG).toBe(0);
    expect(body.foods[1].portions).toEqual([]);
  });

  it('filters by group, pages, and lists the groups with counts', async () => {
    expect(names(await call('GET', '/v1/foods?q=test&group=Test%20cereals'))).toEqual(['Test rice']);
    const page = (await call('GET', '/v1/foods?q=test&limit=1&offset=1')).json();
    expect(page.foods).toHaveLength(1);
    expect(page.total).toBe(3);
    const groups = (await call('GET', '/v1/foods/groups')).json().groups as { value: string; count: number }[];
    expect(groups.find((g) => g.value === 'Test milk')?.count).toBe(1);
  });

  it('refuses a bad limit', async () => {
    expect((await call('GET', '/v1/foods?limit=0')).statusCode).toBe(400);
  });

  it('lets a template use a food from the list, filling in its name and nutrition, and refuses an unknown or hidden one', async () => {
    const slot = (foodId: string) => ({ name: 'B', logsAs: 'breakfast', options: [{ name: 'A', note: '', ingredients: [{ foodId, grams: 50, label: 'Half', proteinSource: true }] }] });
    const make = (foodId: string) => call('POST', '/v1/diet-templates', { name: 'Foods', goal: 'weight_loss', visibility: 'personal', content: { calorieTarget: null, proteinTarget: null, note: '', slots: [slot(foodId)] } });
    const ok = await make(ids['T-PANEER']!);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().template.content.slots[0].options[0].ingredients[0]).toMatchObject({ foodId: ids['T-PANEER'], name: 'Test paneer', kcal: 132.5, proteinG: 9.2 });
    expect((await make(randomUUID())).statusCode).toBe(400);
    expect((await make(ids['T-HIDDEN']!)).statusCode).toBe(400);
  });
});
