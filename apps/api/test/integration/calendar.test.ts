// Calendar (CF09) against schemas app and coach on the test database: scheduling workouts (once and
// repeating, with conflicts as warnings) and diet plans, who sees what, the worked-out status, moving,
// completing and removing. Synthetic data only.
import { addDays } from '@fitsphere-coach/shared';
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

async function call(method: 'GET' | 'POST' | 'PUT', url: string, subject: string, payload?: object) {
  const token = await signToken(keys, subject);
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}
async function link(kind: 'coach_trainee' | 'head_coach_coach', upper: string, lower: string) {
  await client.query(`insert into app.links (kind, upper_user_id, lower_user_id, status, started_at) values ($1, $2, $3, 'active', now())`, [kind, upper, lower]);
}

const indiaToday = async () => (await client.query(`select ((now() at time zone 'Asia/Kolkata')::date)::text as d`)).rows[0].d as string;

async function gym() {
  const head = await insertAccount(client, ['personal', 'head_coach']);
  const ravi = await insertAccount(client, ['personal', 'coach']);
  const meera = await insertAccount(client, ['personal', 'coach']);
  for (const [a, n] of [[head, 'Asha Rao'], [ravi, 'Ravi Kumar'], [meera, 'Meera Joshi']] as const) await client.query('insert into coach.profiles (user_id, full_name) values ($1, $2)', [a.id, n]);
  await link('head_coach_coach', head.id, ravi.id);
  await link('head_coach_coach', head.id, meera.id);
  const underRavi = await insertAccount(client);
  const underMeera = await insertAccount(client);
  await link('coach_trainee', ravi.id, underRavi.id);
  await link('coach_trainee', meera.id, underMeera.id);
  return { head, ravi, meera, underRavi, underMeera };
}

const exercise = { exerciseId: 'bench-press', group: null, sets: 3, repsMin: 8, repsMax: 10, weightG: null, rpe: null, restS: 120, note: '' };
const workoutContent = {
  weeks: 8, scheduleMode: 'rotating', weeklyTarget: null, dailyTarget: false,
  days: [
    { name: 'Push', weekday: null, rest: false, exercises: [exercise] },
    { name: 'Rest', weekday: null, rest: true, exercises: [] },
    { name: 'Pull', weekday: null, rest: false, exercises: [exercise] },
    { name: 'Legs', weekday: null, rest: false, exercises: [exercise] },
  ],
};
/** An active plan for a client, written straight into the coach tables. */
async function activeWorkoutPlan(g: Awaited<ReturnType<typeof gym>>, traineeId: string, status = 'active') {
  const { rows } = await client.query(
    `insert into coach.training_plans (trainee_id, gym_head_coach_id, created_by, name, status, start_date, content, version, live_version, published_at, ended_at)
     values ($1, $2, $3, 'Push / Pull / Legs', $4, current_date, $5, 1, $6, $7, $8) returning id`,
    [traineeId, g.head.id, g.ravi.id, status, JSON.stringify(workoutContent), status === 'draft' ? null : 1, status === 'draft' ? null : new Date(), status === 'ended' ? new Date() : null],
  );
  return rows[0].id as string;
}
async function activeDietPlan(g: Awaited<ReturnType<typeof gym>>, traineeId: string, name = 'Lean 1,800') {
  const { rows } = await client.query(
    `insert into coach.diet_plans (trainee_id, gym_head_coach_id, created_by, name, status, start_date, content, version, live_version, published_at)
     values ($1, $2, $3, $4, 'active', current_date, '{"calorieTarget":null,"proteinTarget":null,"note":"","slots":[]}', 1, 1, now()) returning id`,
    [traineeId, g.head.id, g.ravi.id, name],
  );
  return rows[0].id as string;
}

const workout = (traineeId: string, planId: string, date: string, over: object = {}) => ({ traineeId, planId, dayIndex: 0, date, time: '07:00', notes: '', repeat: null, skipDates: [], ...over });
const nutrition = (traineeId: string, planId: string, from: string, to: string, over: object = {}) => ({ traineeId, planId, from, to, notes: '', ...over });
const span = (from: string, days = 30) => `from=${from}&to=${addDays(from, days)}`;

describe('options', () => {
  it("lists the client's active plans with the training days only; another coach's client is not found", async () => {
    const g = await gym();
    const plan = await activeWorkoutPlan(g, g.underRavi.id);
    await activeWorkoutPlan(g, g.underRavi.id, 'draft');
    const diet = await activeDietPlan(g, g.underRavi.id);
    const res = await call('GET', `/v1/calendar/options?traineeId=${g.underRavi.id}`, g.ravi.subject);
    expect(res.json()).toEqual({
      workoutPlan: { id: plan, name: 'Push / Pull / Legs', days: [{ index: 0, name: 'Push' }, { index: 2, name: 'Pull' }, { index: 3, name: 'Legs' }] },
      dietPlan: { id: diet, name: 'Lean 1,800' },
    });
    expect((await call('GET', `/v1/calendar/options?traineeId=${g.underMeera.id}`, g.ravi.subject)).statusCode).toBe(404);
    expect((await call('GET', `/v1/calendar/options?traineeId=${g.underMeera.id}`, g.head.subject)).statusCode).toBe(200);
    const none = await call('GET', `/v1/calendar/options?traineeId=${g.underMeera.id}`, g.meera.subject);
    expect(none.json()).toEqual({ workoutPlan: null, dietPlan: null });
  });
});

describe('scheduling a workout', () => {
  it('schedules one workout and shows it in the calendar as assigned, with the coach', async () => {
    const g = await gym();
    const plan = await activeWorkoutPlan(g, g.underRavi.id);
    const date = addDays(await indiaToday(), 2);
    const res = await call('POST', '/v1/calendar/workouts', g.ravi.subject, workout(g.underRavi.id, plan, date, { dayIndex: 2, notes: 'Warm up' }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ count: 1, conflicts: [] });
    const list = (await call('GET', `/v1/calendar?${span(date, 0)}&traineeId=${g.underRavi.id}`, g.ravi.subject)).json().activities;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'workout', title: 'Pull', planName: 'Push / Pull / Legs', startDate: date, endDate: date, time: '07:00', notes: 'Warm up', status: 'assigned', coachName: 'Ravi Kumar' });
  });

  it('repeats on chosen weekdays for N weeks, giving out the training days in turn, and previews the same dates', async () => {
    const g = await gym();
    const plan = await activeWorkoutPlan(g, g.underRavi.id);
    // A Monday at least a week ahead, so the dates are known.
    let monday = addDays(await indiaToday(), 7);
    while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, 1);
    const body = workout(g.underRavi.id, plan, monday, { repeat: { weekdays: [1, 3, 5], weeks: 2 } });
    const preview = (await call('POST', '/v1/calendar/workouts/preview', g.ravi.subject, body)).json();
    expect(preview.dates.map((d: { date: string }) => d.date)).toEqual([0, 2, 4, 7, 9, 11].map((n) => addDays(monday, n)));
    // Push, Pull, Legs, Push, Pull, Legs: the rest day is skipped.
    expect(preview.dates.map((d: { dayName: string }) => d.dayName)).toEqual(['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs']);
    expect((await client.query('select 1 from coach.calendar_activities where trainee_id = $1', [g.underRavi.id])).rowCount).toBe(0);

    const skip = addDays(monday, 2);
    const saved = await call('POST', '/v1/calendar/workouts', g.ravi.subject, { ...body, skipDates: [skip] });
    expect(saved.json().count).toBe(5);
    const rows = (await client.query('select start_date::text, series_id from coach.calendar_activities where trainee_id = $1 order by start_date', [g.underRavi.id])).rows;
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.series_id)).size).toBe(1);
    expect(rows.map((r) => r.start_date)).not.toContain(skip);
  });

  it('warns about a conflict (same client, same day and time) but still saves', async () => {
    const g = await gym();
    const plan = await activeWorkoutPlan(g, g.underRavi.id);
    const date = addDays(await indiaToday(), 3);
    await call('POST', '/v1/calendar/workouts', g.ravi.subject, workout(g.underRavi.id, plan, date));
    const body = workout(g.underRavi.id, plan, date, { dayIndex: 2 });
    expect((await call('POST', '/v1/calendar/workouts/preview', g.ravi.subject, body)).json().dates[0].conflict).toBe(true);
    const again = await call('POST', '/v1/calendar/workouts', g.ravi.subject, body);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual({ count: 1, conflicts: [date] });
    const other = await call('POST', '/v1/calendar/workouts/preview', g.ravi.subject, { ...body, time: '18:30' });
    expect(other.json().dates[0].conflict).toBe(false);
  });

  it('refuses a past date, a rest day, a bad time, too many weeks, a repeat with no dates, and unknown fields', async () => {
    const g = await gym();
    const plan = await activeWorkoutPlan(g, g.underRavi.id);
    const date = addDays(await indiaToday(), 2);
    const bad = async (over: object) => (await call('POST', '/v1/calendar/workouts', g.ravi.subject, workout(g.underRavi.id, plan, date, over))).statusCode;
    expect(await bad({ date: addDays(await indiaToday(), -1) })).toBe(400);
    expect(await bad({ dayIndex: 1 })).toBe(400);
    expect(await bad({ time: '25:00' })).toBe(400);
    expect(await bad({ repeat: { weekdays: [1], weeks: 13 } })).toBe(400);
    expect(await bad({ repeat: { weekdays: [1, 2, 3, 4, 5, 6, 7], weeks: 1 }, skipDates: Array.from({ length: 7 }, (_, i) => addDays(date, i)) })).toBe(400);
    expect(await bad({ extra: true })).toBe(400);
  });

  it('needs the client’s own active plan, and a client the coach may see', async () => {
    const g = await gym();
    const date = addDays(await indiaToday(), 2);
    const draft = await activeWorkoutPlan(g, g.underRavi.id, 'draft');
    expect((await call('POST', '/v1/calendar/workouts', g.ravi.subject, workout(g.underRavi.id, draft, date))).statusCode).toBe(404);
    const theirs = await activeWorkoutPlan(g, g.underMeera.id);
    expect((await call('POST', '/v1/calendar/workouts', g.ravi.subject, workout(g.underRavi.id, theirs, date))).statusCode).toBe(404);
    expect((await call('POST', '/v1/calendar/workouts', g.ravi.subject, workout(g.underMeera.id, theirs, date))).statusCode).toBe(404);
    expect((await call('POST', '/v1/calendar/workouts', g.head.subject, workout(g.underMeera.id, theirs, date))).statusCode).toBe(201);
  });
});

describe('scheduling a diet plan', () => {
  it('schedules a full-day plan over a range; an older schedule that overlaps is cut short or replaced', async () => {
    const g = await gym();
    const diet = await activeDietPlan(g, g.underRavi.id);
    const today = await indiaToday();
    const first = await call('POST', '/v1/calendar/nutrition', g.ravi.subject, nutrition(g.underRavi.id, diet, addDays(today, 1), addDays(today, 20)));
    expect(first.json()).toEqual({ count: 1, conflicts: [] });
    // A new range starting inside the old one cuts the old one short.
    const second = await call('POST', '/v1/calendar/nutrition', g.ravi.subject, nutrition(g.underRavi.id, diet, addDays(today, 10), addDays(today, 30)));
    expect(second.json().conflicts).toEqual([addDays(today, 1)]);
    const rows = (await client.query(`select start_date::text s, end_date::text e from coach.calendar_activities where trainee_id = $1 and status <> 'removed' order by start_date`, [g.underRavi.id])).rows;
    expect(rows).toEqual([{ s: addDays(today, 1), e: addDays(today, 9) }, { s: addDays(today, 10), e: addDays(today, 30) }]);
    // A new range that starts before the old one removes it.
    await call('POST', '/v1/calendar/nutrition', g.ravi.subject, nutrition(g.underRavi.id, diet, addDays(today, 1), addDays(today, 40)));
    const left = (await client.query(`select 1 from coach.calendar_activities where trainee_id = $1 and status <> 'removed'`, [g.underRavi.id])).rowCount;
    expect(left).toBe(1);
  });

  it('refuses a past start, an end before the start, and more than 90 days', async () => {
    const g = await gym();
    const diet = await activeDietPlan(g, g.underRavi.id);
    const today = await indiaToday();
    const status = async (from: string, to: string) => (await call('POST', '/v1/calendar/nutrition', g.ravi.subject, nutrition(g.underRavi.id, diet, from, to))).statusCode;
    expect(await status(addDays(today, -1), addDays(today, 5))).toBe(400);
    expect(await status(addDays(today, 5), addDays(today, 4))).toBe(400);
    expect(await status(addDays(today, 1), addDays(today, 91))).toBe(400);
    expect(await status(addDays(today, 1), addDays(today, 90))).toBe(201);
  });

  it('needs the client’s active diet plan', async () => {
    const g = await gym();
    const today = await indiaToday();
    const other = await activeDietPlan(g, g.underMeera.id);
    expect((await call('POST', '/v1/calendar/nutrition', g.ravi.subject, nutrition(g.underRavi.id, other, addDays(today, 1), addDays(today, 5)))).statusCode).toBe(404);
  });
});

describe('the calendar and who sees it', () => {
  it("a Coach sees only their clients' activities; the Head Coach all, and can filter by coach; another gym none", async () => {
    const g = await gym();
    const other = await gym();
    const date = addDays(await indiaToday(), 2);
    const pr = await activeWorkoutPlan(g, g.underRavi.id);
    const pm = await activeWorkoutPlan(g, g.underMeera.id);
    await call('POST', '/v1/calendar/workouts', g.head.subject, workout(g.underRavi.id, pr, date));
    await call('POST', '/v1/calendar/workouts', g.head.subject, workout(g.underMeera.id, pm, date));
    const q = span(date, 0);
    expect((await call('GET', `/v1/calendar?${q}`, g.ravi.subject)).json().activities.map((a: { traineeId: string }) => a.traineeId)).toEqual([g.underRavi.id]);
    const head = (await call('GET', `/v1/calendar?${q}`, g.head.subject)).json();
    expect(head.activities).toHaveLength(2);
    expect(head.coaches).toHaveLength(2);
    expect((await call('GET', `/v1/calendar?${q}&coachId=${g.meera.id}`, g.head.subject)).json().activities.map((a: { traineeId: string }) => a.traineeId)).toEqual([g.underMeera.id]);
    expect((await call('GET', `/v1/calendar?${q}`, other.head.subject)).json().activities).toEqual([]);
  });

  it('refuses a span of more than 92 days, a reversed span, and a bad date', async () => {
    const g = await gym();
    const today = await indiaToday();
    expect((await call('GET', `/v1/calendar?from=${today}&to=${addDays(today, 93)}`, g.ravi.subject)).statusCode).toBe(400);
    expect((await call('GET', `/v1/calendar?from=${today}&to=${addDays(today, -1)}`, g.ravi.subject)).statusCode).toBe(400);
    expect((await call('GET', `/v1/calendar?from=soon&to=${today}`, g.ravi.subject)).statusCode).toBe(400);
    expect((await call('GET', `/v1/calendar?${span(today)}`, g.underRavi.subject)).statusCode).toBe(403);
  });

  it('works out the status: missed, completed by the client’s own log, completed by a coach, rescheduled, and a finished diet plan', async () => {
    const g = await gym();
    const plan = await activeWorkoutPlan(g, g.underRavi.id);
    const today = await indiaToday();
    const insert = async (daysFromToday: number, kind = 'workout', end = daysFromToday) =>
      (await client.query(
        `insert into coach.calendar_activities (trainee_id, gym_head_coach_id, created_by, kind, training_plan_id, diet_plan_id, day_index, title, plan_name, start_date, end_date)
         values ($1, $2, $3, $4, $5, $6, $7, 'Push', 'P', $8, $9) returning id`,
        [g.underRavi.id, g.head.id, g.ravi.id, kind, kind === 'workout' ? plan : null, kind === 'nutrition' ? await activeDietPlan(g, randomUUID() && (await insertAccount(client)).id) : null, kind === 'workout' ? 0 : null, addDays(today, daysFromToday), addDays(today, end)],
      )).rows[0].id as string;
    const missed = await insert(-3);
    const logged = await insert(-2);
    const future = await insert(2);
    await client.query(`insert into app.workouts (user_id, id, day, exercises, recorded_at) values ($1, $2, $3, '[]', now())`, [g.underRavi.id, randomUUID(), addDays(today, -2)]);
    const done = await call('POST', `/v1/calendar/activities/${future}/complete`, g.ravi.subject);
    expect(done.json().activity.status).toBe('completed');
    const moved = await insert(4);
    await call('PUT', `/v1/calendar/activities/${moved}`, g.ravi.subject, { date: addDays(today, 5), time: null, reason: '' });

    const list = (await call('GET', `/v1/calendar?from=${addDays(today, -5)}&to=${addDays(today, 10)}`, g.ravi.subject)).json().activities as { id: string; status: string }[];
    const byId = Object.fromEntries(list.map((a) => [a.id, a.status]));
    expect(byId[missed]).toBe('missed');
    expect(byId[logged]).toBe('completed');
    expect(byId[future]).toBe('completed');
    expect(byId[moved]).toBe('rescheduled');
  });
});

describe('changing an activity', () => {
  async function scheduled(g: Awaited<ReturnType<typeof gym>>, daysAhead = 3, over: object = {}) {
    const plan = await activeWorkoutPlan(g, g.underRavi.id);
    const date = addDays(await indiaToday(), daysAhead);
    await call('POST', '/v1/calendar/workouts', g.ravi.subject, workout(g.underRavi.id, plan, date, over));
    const list = (await call('GET', `/v1/calendar?${span(date, 0)}&traineeId=${g.underRavi.id}`, g.ravi.subject)).json().activities;
    return { id: list[0].id as string, date };
  }

  it('moves an activity, keeps the old date and the reason in the history, and shows it as rescheduled', async () => {
    const g = await gym();
    const { id, date } = await scheduled(g);
    const to = addDays(date, 1);
    const res = await call('PUT', `/v1/calendar/activities/${id}`, g.head.subject, { date: to, time: '08:30', reason: 'Client is travelling' });
    expect(res.statusCode).toBe(200);
    expect(res.json().activity).toMatchObject({ startDate: to, time: '08:30', status: 'rescheduled' });
    expect(res.json().activity.history).toMatchObject([
      { action: 'scheduled', toDate: date, actorName: 'Ravi Kumar', actorRole: 'coach' },
      { action: 'moved', fromDate: date, toDate: to, reason: 'Client is travelling', actorName: 'Asha Rao', actorRole: 'head_coach' },
    ]);
  });

  it('refuses a move to the past, of a completed activity, by another coach; a diet plan moves with its length and no time', async () => {
    const g = await gym();
    const { id, date } = await scheduled(g);
    expect((await call('PUT', `/v1/calendar/activities/${id}`, g.ravi.subject, { date: addDays(await indiaToday(), -1), time: null, reason: '' })).statusCode).toBe(400);
    expect((await call('PUT', `/v1/calendar/activities/${id}`, g.meera.subject, { date, time: null, reason: '' })).statusCode).toBe(404);
    await call('POST', `/v1/calendar/activities/${id}/complete`, g.ravi.subject);
    expect((await call('PUT', `/v1/calendar/activities/${id}`, g.ravi.subject, { date: addDays(date, 1), time: null, reason: '' })).statusCode).toBe(403);

    const diet = await activeDietPlan(g, g.underRavi.id);
    const today = await indiaToday();
    await call('POST', '/v1/calendar/nutrition', g.ravi.subject, nutrition(g.underRavi.id, diet, addDays(today, 5), addDays(today, 14)));
    const nid = (await call('GET', `/v1/calendar?${span(addDays(today, 5), 0)}&traineeId=${g.underRavi.id}`, g.ravi.subject)).json().activities.find((a: { kind: string }) => a.kind === 'nutrition').id as string;
    expect((await call('PUT', `/v1/calendar/activities/${nid}`, g.ravi.subject, { date: addDays(today, 8), time: '07:00', reason: '' })).statusCode).toBe(400);
    const moved = await call('PUT', `/v1/calendar/activities/${nid}`, g.ravi.subject, { date: addDays(today, 8), time: null, reason: '' });
    expect(moved.json().activity).toMatchObject({ startDate: addDays(today, 8), endDate: addDays(today, 17) });
  });

  it('marks done by a coach and removes from the calendar, both logged; a removed activity is gone', async () => {
    const g = await gym();
    const { id, date } = await scheduled(g);
    const done = await call('POST', `/v1/calendar/activities/${id}/complete`, g.ravi.subject);
    expect(done.json().activity.status).toBe('completed');
    expect(done.json().activity.history.map((h: { action: string }) => h.action)).toEqual(['scheduled', 'completed']);
    expect((await call('POST', `/v1/calendar/activities/${id}/remove`, g.ravi.subject)).statusCode).toBe(204);
    expect((await call('GET', `/v1/calendar/activities/${id}`, g.ravi.subject)).statusCode).toBe(404);
    expect((await call('GET', `/v1/calendar?${span(date, 0)}`, g.ravi.subject)).json().activities).toEqual([]);
    expect((await client.query(`select action from coach.calendar_changes where activity_id = $1 order by created_at, id`, [id])).rows.map((r) => r.action)).toEqual(['scheduled', 'completed', 'removed']);
  });

  it('is hidden from another coach and another gym; a malformed id is not found', async () => {
    const g = await gym();
    const other = await gym();
    const { id } = await scheduled(g);
    for (const subject of [g.meera.subject, other.head.subject]) {
      expect((await call('GET', `/v1/calendar/activities/${id}`, subject)).statusCode).toBe(404);
      expect((await call('POST', `/v1/calendar/activities/${id}/complete`, subject)).statusCode).toBe(404);
      expect((await call('POST', `/v1/calendar/activities/${id}/remove`, subject)).statusCode).toBe(404);
    }
    expect((await call('GET', '/v1/calendar/activities/not-an-id', g.ravi.subject)).statusCode).toBe(404);
  });

  it('ends the access with the link: an activity of a removed client is no longer visible', async () => {
    const g = await gym();
    const { id } = await scheduled(g);
    await client.query(`update app.links set status = 'ended', ended_at = now(), end_reason = 'removed' where lower_user_id = $1`, [g.underRavi.id]);
    expect((await call('GET', `/v1/calendar/activities/${id}`, g.ravi.subject)).statusCode).toBe(404);
  });
});
