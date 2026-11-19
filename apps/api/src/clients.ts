// Client management (CF04, SPEC-001 → coach-scope §3.4): who a coach may see, and moving and
// removing a client. A "client" is a trainee with an active `coach_trainee` link in schema `app`.
//
// Who sees whom (invariants 1, 14; C-D12, C-D18):
// - a Coach sees only the trainees linked to them;
// - the Head Coach sees the trainees linked to them and to every Coach of their gym, and which Coach
//   each belongs to. A gym's Coaches are the users the Head Coach has an active `head_coach_coach`
//   link to (interim until CF03 adds gym membership, ADR-0006);
// - nobody sees anyone else's trainee: the answer is "not found", never "not yours".
// Only the person higher up removes or moves: the Head Coach moves; the Head Coach or the trainee's own
// Coach removes. Moving needs no new consent (C-D26). Removal ends the link and deletes nothing (C-D28).
// Former clients (ended links) are not shown here: their read-only history switches on only after the
// consent text covers it (TCR-001, C-D28).
import type { ClientExercisesResponse, ClientListResponse, ClientLoggedWorkout, ClientProfile, ClientSummary, PlanContent } from '@fitsphere-coach/shared';
import type pg from 'pg';
import type { Account } from './accounts.ts';
import { ApiError } from './errors.ts';
import { userColumnExists } from './addClient.ts';
import { exerciseDetails } from './exercises.ts';
import { gymOf, invitesEnabled, listInvitations } from './invitations.ts';
import { linkWaitingClients, listWaiting, moveWaiting, removeWaiting, updateWaiting, waitingProfile } from './waitingClients.ts';
import type { OnboardingDeps } from './onboarding.ts';

type Queryable = Pick<pg.Pool, 'query'>;

export const isHeadCoach = (account: Account) => account.roles.includes('head_coach');

/** The coaches the viewer may see clients of: themselves, plus the gym's Coaches for the Head Coach. */
export const VISIBLE_UPPERS = `
  select $1::uuid as id
  union
  select l.lower_user_id from app.links l
  where $2::boolean and l.kind = 'head_coach_coach' and l.status = 'active' and l.upper_user_id = $1`;

const LAST_LOGGED = `
  greatest(
    (select max(m.recorded_at) from app.meals m where m.user_id = l.lower_user_id and m.deleted_at is null),
    (select max(w.recorded_at) from app.workouts w where w.user_id = l.lower_user_id and w.deleted_at is null),
    (select max(b.recorded_at) from app.weigh_ins b where b.user_id = l.lower_user_id)
  )`;

type Row = {
  trainee_id: string;
  name: string;
  coach_id: string;
  coach_name: string | null;
  started_at: Date;
  last_logged_at: Date | null;
};

const toSummary = (row: Row): ClientSummary => ({
  id: row.trainee_id,
  name: row.name,
  coachId: row.coach_id,
  coachName: row.coach_name,
  startedAt: row.started_at.toISOString(),
  lastLoggedAt: row.last_logged_at ? row.last_logged_at.toISOString() : null,
});

const SELECT_CLIENTS = `
  select l.lower_user_id as trainee_id,
         -- The trainee's name once TCR-001 adds app.users.full_name; their email until then. to_jsonb
         -- reads the column only if it exists, so this runs before and after that change.
         coalesce(nullif(gc.full_name, ''), nullif(to_jsonb(u) ->> 'full_name', ''), u.email) as name,
         l.upper_user_id as coach_id, p.full_name as coach_name,
         l.started_at, ${LAST_LOGGED} as last_logged_at
  from app.links l
  join app.users u on u.id = l.lower_user_id
  left join coach.gym_clients gc on gc.client_id = l.lower_user_id
  left join coach.profiles p on p.user_id = l.upper_user_id
  where l.kind = 'coach_trainee' and l.status = 'active'
    and l.upper_user_id in (${VISIBLE_UPPERS})`;

export async function listClients(
  db: Queryable,
  viewer: Account,
  filter: { q?: string | undefined; coachId?: string | undefined },
  deps: OnboardingDeps,
): Promise<ClientListResponse> {
  const head = isHeadCoach(viewer);
  await linkWaiting(db, viewer);
  const { rows } = await db.query<Row>(
    `${SELECT_CLIENTS}
       and ($3::text is null or u.email ilike '%' || $3 || '%' or to_jsonb(u) ->> 'full_name' ilike '%' || $3 || '%')
       and ($4::uuid is null or l.upper_user_id = $4)
     order by lower(u.email)`,
    [viewer.id, head, filter.q?.trim() || null, filter.coachId ?? null],
  );
  const waiting = await listWaiting(db, viewer, filter);
  const clients = [...rows.map(toSummary), ...waiting].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return {
    clients,
    coaches: head ? await gymCoaches(db, viewer) : [],
    canInvite: invitesEnabled(deps),
    canAdd: head,
    invitations: await listInvitations(db, viewer, deps),
  };
}

/** Promotes the gym's waiting clients whose email now has a FitSphere account (waitingClients.ts). */
async function linkWaiting(db: Queryable, viewer: Account): Promise<void> {
  const gym = await gymOf(db, viewer);
  if (gym) await linkWaitingClients(db, gym.headCoachId);
}

/** The Head Coach's gym Coaches with their names. Empty for anyone else. */
async function gymCoaches(db: Queryable, viewer: Account): Promise<ClientListResponse['coaches']> {
  const { rows } = await db.query<{ id: string; full_name: string | null }>(
    `select l.lower_user_id as id, p.full_name
     from app.links l left join coach.profiles p on p.user_id = l.lower_user_id
     where l.kind = 'head_coach_coach' and l.status = 'active' and l.upper_user_id = $1
     order by lower(coalesce(p.full_name, ''))`,
    [viewer.id],
  );
  return rows.map((row) => ({ id: row.id, name: row.full_name }));
}

/** One visible client's summary, or null when the viewer may not see them (answered as not found). */
export async function findClient(db: Queryable, viewer: Account, traineeId: string): Promise<Row | null> {
  const { rows } = await db.query<Row>(`${SELECT_CLIENTS} and l.lower_user_id = $3`, [viewer.id, isHeadCoach(viewer), traineeId]);
  return rows[0] ?? null;
}

const NOT_FOUND = () => new ApiError('NOT_FOUND');

export async function clientProfile(db: Queryable, viewer: Account, traineeId: string): Promise<ClientProfile> {
  await linkWaiting(db, viewer);
  const client = await findClient(db, viewer, traineeId);
  if (!client) return waitingProfile(db, viewer, traineeId);

  const { rows: weights } = await db.query<{ weight_grams: number }>(
    'select weight_grams from app.weigh_ins where user_id = $1 order by day desc limit 1',
    [traineeId],
  );
  const { rows: targetRows } = await db.query<{ kind: string; value: number }>(
    `select kind, value from app.targets where user_id = $1 and kind in ('calories', 'protein', 'weekly_workouts')`,
    [traineeId],
  );
  const target = (kind: string) => targetRows.find((row) => row.kind === kind)?.value ?? null;
  // The India week, Monday to Sunday (invariant 4): `day` is the day the trainee chose.
  const { rows: workouts } = await db.query<{ n: number }>(
    `select count(*)::int as n from app.workouts
     where user_id = $1 and deleted_at is null
       and day >= date_trunc('week', (now() at time zone 'Asia/Kolkata')::date)::date`,
    [traineeId],
  );
  const { rows: extra } = await db.query<{
    email: string;
    phone: string | null;
    fitness_goal: string | null;
    notes: string | null;
    is_gym_member: boolean | null;
  }>(
    `select u.email, gc.phone, gc.fitness_goal, gc.notes, gc.is_gym_member
     from app.users u left join coach.gym_clients gc on gc.client_id = u.id where u.id = $1`,
    [traineeId],
  );
  const more = extra[0];
  return {
    ...toSummary(client),
    ...(more
      ? { email: more.email, phone: more.phone, fitnessGoal: more.fitness_goal, notes: more.notes, isGymMember: more.is_gym_member ?? false }
      : {}),
    latestWeightKg: weights[0] ? weights[0].weight_grams / 1000 : null,
    targets: { calories: target('calories'), proteinG: target('protein'), weeklyWorkouts: target('weekly_workouts') },
    workoutsThisWeek: workouts[0]?.n ?? 0,
  };
}

/** Removes a client: ends the link, deletes nothing. The Head Coach or the client's own Coach may. */
export async function removeClient(db: pg.Pool, viewer: Account, traineeId: string): Promise<void> {
  const client = await findClient(db, viewer, traineeId);
  if (!client) return removeWaiting(db, viewer, traineeId);
  // A Coach removes only their own; `findClient` already limits a Coach to their own trainees.
  const { rowCount } = await db.query(
    `update app.links set status = 'ended', ended_at = now(), end_reason = 'removed'
     where kind = 'coach_trainee' and status = 'active' and lower_user_id = $1 and upper_user_id = $2`,
    [traineeId, client.coach_id],
  );
  if (!rowCount) throw NOT_FOUND();
  // No longer in any gym: clear the trainee app's flag, once its column exists (TCR-007).
  if (await userColumnExists(db, 'is_gym_member')) {
    await db.query(
      `update app.users u set is_gym_member = false
       where u.id = $1 and not exists (select 1 from app.links l where l.lower_user_id = u.id and l.kind = 'coach_trainee' and l.status = 'active')`,
      [traineeId],
    );
  }
}

/**
 * The Head Coach moves a client to another Coach of the gym, or to themselves (C-D21). In one
 * transaction the old link ends (reason "switched") and a new one starts; no new consent (C-D26).
 */
export async function moveClient(db: pg.Pool, viewer: Account, traineeId: string, coachId: string): Promise<void> {
  if (!isHeadCoach(viewer)) throw new ApiError('NOT_PERMITTED');
  const client = await findClient(db, viewer, traineeId);
  if (!client) return moveWaiting(db, viewer, traineeId, coachId);
  const target = await db.query(
    `select 1 where $2::uuid = $1::uuid
       or exists (select 1 from app.links where kind = 'head_coach_coach' and status = 'active' and upper_user_id = $1 and lower_user_id = $2)`,
    [viewer.id, coachId],
  );
  if (target.rowCount === 0 || coachId === client.coach_id) {
    throw new ApiError('VALIDATION_FAILED', [{ field: 'coachId', issue: 'invalid_format' }]);
  }

  const tx = await db.connect();
  try {
    await tx.query('begin');
    const ended = await tx.query(
      `update app.links set status = 'ended', ended_at = now(), end_reason = 'switched'
       where kind = 'coach_trainee' and status = 'active' and lower_user_id = $1 and upper_user_id = $2`,
      [traineeId, client.coach_id],
    );
    if (!ended.rowCount) throw NOT_FOUND();
    await tx.query(
      `insert into app.links (kind, upper_user_id, lower_user_id, status, started_at)
       values ('coach_trainee', $1, $2, 'active', now())`,
      [coachId, traineeId],
    );
    await tx.query('commit');
  } catch (error) {
    await tx.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}

/**
 * Edits the details the gym keeps for a client (CF04 edit). The Head Coach edits any client of the gym,
 * a Coach their own (`findClient` limits who is visible). The email is the login and is not editable.
 * Stored in `coach.gym_clients`; a client who joined another way gets their row on the first edit.
 */
export async function updateClient(
  db: Queryable,
  viewer: Account,
  traineeId: string,
  input: { fullName: string; phone: string | null; fitnessGoal: string | null; notes: string | null },
): Promise<void> {
  const client = await findClient(db, viewer, traineeId);
  if (!client) return updateWaiting(db, viewer, traineeId, input);
  const gym = await gymOf(db, viewer);
  if (!gym) throw new ApiError('NOT_PERMITTED');
  await db.query(
    `insert into coach.gym_clients (client_id, gym_head_coach_id, added_by, full_name, phone, fitness_goal, notes, is_gym_member, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, false, $3)
     on conflict (client_id) do update
       set full_name = excluded.full_name, phone = excluded.phone, fitness_goal = excluded.fitness_goal,
           notes = excluded.notes, updated_at = now(), updated_by = $3`,
    [traineeId, gym.headCoachId, viewer.id, input.fullName, input.phone, input.fitnessGoal, input.notes],
  );
}

/**
 * A client's current training plan (the live one, else the draft) with each exercise's library details
 * from schema `app` (read only), and the workouts the client logged in the FitSphere app. The logs hold
 * free-text names, not library codes, so they are shown as logged and not matched to the plan.
 */
export async function clientExercises(db: Queryable, viewer: Account, traineeId: string): Promise<ClientExercisesResponse> {
  const client = await findClient(db, viewer, traineeId);
  if (!client) throw NOT_FOUND();
  const { rows: plans } = await db.query<{ id: string; name: string; status: 'active' | 'draft'; content: PlanContent }>(
    `select id, name, status, content from coach.training_plans
     where trainee_id = $1 and status in ('active', 'draft')
     order by (status = 'active') desc limit 1`,
    [traineeId],
  );
  const plan = plans[0];
  let planOut: ClientExercisesResponse['plan'] = null;
  if (plan) {
    const codes = plan.content.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseId));
    const details = await exerciseDetails(db, codes);
    planOut = {
      id: plan.id,
      name: plan.name,
      status: plan.status,
      weeks: plan.content.weeks,
      days: plan.content.days.map((day) => ({
        name: day.name,
        weekday: day.weekday,
        rest: day.rest,
        exercises: day.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          name: details.get(exercise.exerciseId)?.name ?? exercise.exerciseId,
          sets: exercise.sets,
          repsMin: exercise.repsMin,
          repsMax: exercise.repsMax,
          weightG: exercise.weightG,
          rpe: exercise.rpe,
          restS: exercise.restS,
          note: exercise.note,
          detail: details.get(exercise.exerciseId) ?? null,
        })),
      })),
    };
  }

  const { rows: logs } = await db.query<{ day: string; exercises: unknown }>(
    `select day::text as day, exercises from app.workouts
     where user_id = $1 and deleted_at is null order by day desc, recorded_at desc limit 10`,
    [traineeId],
  );
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const recent: ClientLoggedWorkout[] = logs.map((log) => ({
    day: log.day,
    exercises: (Array.isArray(log.exercises) ? log.exercises : []).flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return [];
      const row = item as Record<string, unknown>;
      return typeof row.name === 'string'
        ? [{ name: row.name, sets: num(row.sets), reps: num(row.reps), weightG: num(row.weightGrams), note: typeof row.note === 'string' && row.note ? row.note : null }]
        : [];
    }),
  }));
  return { plan: planOut, recent };
}
