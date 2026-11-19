// The Gym Owner adds a client directly (CF04, SPEC-001 §4.2a, C-D31 proposed).
//
// A client is a FitSphere user (`app.users`). Adding one:
//  1. finds the user by email: the client must have signed up in the FitSphere app first (owner, 2026-11-12), so
//     this repo never creates sign-in accounts and needs no Supabase service key;
//  2. records the client in `coach.gym_clients` (name, gym, `is_gym_member = true`), because this repo
//     never changes schema `app` (C-D22; the real `app.users.is_gym_member` is TCR-006, later);
//  3. starts the `coach_trainee` link under the chosen Coach or the Head Coach (C-D21), so plans, the
//     calendar and the logs we read work as for every other client.
// The admin's add stands as the client's consent to share data with the gym (owner, 2026-11-12).
// Only the Head Coach (the gym owner for now, Q10) may add. The server refuses everything else.
import type { AddClientRequest } from '@fitsphere-coach/shared';
import type pg from 'pg';
import type { Account } from './accounts.ts';
import { ApiError } from './errors.ts';
import { gymOf, GYM_PEOPLE } from './invitations.ts';
import type { OnboardingDeps } from './onboarding.ts';

export async function addClient(
  db: pg.Pool,
  viewer: Account,
  input: { email: string; fullName: string; coachId?: string | undefined },
  deps: OnboardingDeps,
): Promise<{ id: string; waiting?: boolean }> {
  if (!viewer.roles.includes('head_coach')) throw new ApiError('NOT_PERMITTED');
  const gym = await gymOf(db, viewer);
  if (!gym) throw new ApiError('NOT_PERMITTED');

  let assignedId = viewer.id;
  if (input.coachId && input.coachId !== viewer.id) {
    const { rowCount } = await db.query(`select 1 from (${GYM_PEOPLE}) people where id = $2`, [viewer.id, input.coachId]);
    if (!rowCount) throw new ApiError('VALIDATION_FAILED', [{ field: 'coachId', issue: 'invalid_format' }]);
    assignedId = input.coachId;
  }

  // A Coach or the Head Coach of this gym is not a client of it (C-D24).
  const staff = await db.query(`select 1 from app.users u where u.email = $2 and u.id in (${GYM_PEOPLE})`, [viewer.id, input.email]);
  if (staff.rowCount) throw new ApiError('CANNOT_INVITE_EMAIL');
  // Already a client of this gym (C-D19).
  const added = await db.query(
    `select 1 from app.links l join app.users u on u.id = l.lower_user_id
     where l.kind = 'coach_trainee' and l.status = 'active' and u.email = $2 and l.upper_user_id in (${GYM_PEOPLE})`,
    [viewer.id, input.email],
  );
  if (added.rowCount) throw new ApiError('ALREADY_ADDED');

  // The client must already have a FitSphere account (they sign up in the FitSphere app first).
  const { rows: found } = await db.query<{ id: string }>('select id from app.users where email = $1', [input.email]);
  const userId = found[0]?.id;
  // No FitSphere account yet: the client waits in `coach.waiting_clients` and is linked when they sign up.
  if (!userId) return addWaiting(db, viewer, gym.headCoachId, assignedId, input);

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`add-client:${input.email}`]);
    await client.query(
      `insert into coach.gym_clients (client_id, gym_head_coach_id, added_by, full_name)
       values ($1, $2, $3, $4)
       on conflict (client_id) do update set full_name = excluded.full_name, gym_head_coach_id = excluded.gym_head_coach_id,
         is_gym_member = true`,
      [userId, gym.headCoachId, viewer.id, input.fullName],
    );
    await client.query(
      `insert into app.links (kind, upper_user_id, lower_user_id, status, started_at)
       values ('coach_trainee', $1, $2, 'active', now())`,
      [assignedId, userId],
    );
    // The trainee app's own flag, once its column exists (TCR-007): the user is now a gym member.
    if (await userColumnExists(client, 'is_gym_member')) {
      await client.query('update app.users set is_gym_member = true where id = $1', [userId]);
    }
    await client.query('commit');
    return { id: userId };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    // One active coach per trainee: the person is already a client somewhere else. Not revealed (invariant 3).
    if ((error as { code?: unknown }).code === '23505') throw new ApiError('CLIENT_UNAVAILABLE');
    throw error;
  } finally {
    client.release();
  }
}

/** Whether `app.users` has a column yet (TCR-007). Checked at request time, so the code works before and after it exists. */
export async function userColumnExists(db: Pick<pg.Pool, 'query'>, column: 'is_gym_member' | 'open_to_gym'): Promise<boolean> {
  const { rowCount } = await db.query(
    `select 1 from information_schema.columns where table_schema = 'app' and table_name = 'users' and column_name = $1`,
    [column],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * FitSphere users who opted in to being found by a gym (TCR-007), for the Gym Owner's Add client picker.
 * Email only; people already in a gym, and the gym's own staff, are left out. Empty and `enabled: false`
 * until the trainee app delivers the setting (C-D22), and for anyone who is not the Head Coach.
 */
export async function findOpenToGym(
  db: Pick<pg.Pool, 'query'>,
  viewer: Account,
  q: string | undefined,
): Promise<{ enabled: boolean; people: { id: string; email: string }[] }> {
  if (!viewer.roles.includes('head_coach') || !(await userColumnExists(db, 'open_to_gym'))) return { enabled: false, people: [] };
  const text = q?.trim() ? q.trim().replace(/[\\%_]/g, (c) => `\\${c}`) : null;
  const { rows } = await db.query<{ id: string; email: string }>(
    `select u.id, u.email from app.users u
     where u.open_to_gym is true and u.id <> $1
       and u.id not in (${GYM_PEOPLE})
       and not exists (select 1 from app.links l where l.lower_user_id = u.id and l.kind = 'coach_trainee' and l.status = 'active')
       and ($2::text is null or u.email ilike '%' || $2 || '%')
     order by lower(u.email) limit 20`,
    [viewer.id, text],
  );
  return { enabled: true, people: rows };
}

/** Saves a client who has no FitSphere account yet. One waiting row per email, across all gyms. */
async function addWaiting(
  db: pg.Pool,
  viewer: Account,
  headCoachId: string,
  assignedId: string,
  input: { email: string; fullName: string },
): Promise<{ id: string; waiting: true }> {
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into coach.waiting_clients (gym_head_coach_id, coach_id, added_by, email, full_name)
       values ($1, $2, $3, $4, $5) returning id`,
      [headCoachId, assignedId, viewer.id, input.email, input.fullName],
    );
    return { id: (rows[0] as { id: string }).id, waiting: true };
  } catch (error) {
    if ((error as { code?: unknown }).code !== '23505') throw error;
    // Already waiting: for this gym that is "already added"; for another gym it is not revealed (invariant 3).
    const { rowCount } = await db.query('select 1 from coach.waiting_clients where email = $1 and gym_head_coach_id = $2', [input.email, headCoachId]);
    throw new ApiError(rowCount ? 'ALREADY_ADDED' : 'CLIENT_UNAVAILABLE');
  }
}

export type { AddClientRequest };
