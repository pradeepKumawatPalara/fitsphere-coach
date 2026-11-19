// Clients the gym added before they have a FitSphere account (CF04, C-D31 proposed).
//
// Nothing is written to `app` or Supabase when a waiting client is added: the trainee API creates the
// `app.users` row itself when the person signs up, with the email from Supabase's confirmed email. Until
// then the client lives in `coach.waiting_clients`. When a gym's client list or a profile is read,
// `linkWaitingClients` promotes every waiting client whose email now has an account: it creates their
// `coach.gym_clients` row and the `coach_trainee` link under the chosen Coach, sets `is_gym_member` if the
// column exists (TCR-007), and removes the waiting row, all in one transaction. Someone who is already a
// client elsewhere, or staff of this gym, stays waiting.
//
// Who sees what (invariant 1): the Head Coach every waiting client of their gym, a Coach only theirs.
// Anything else is "not found". Only the Head Coach moves a client to another Coach (C-D21).
import type { ClientProfile, ClientSummary } from '@fitsphere-coach/shared';
import type pg from 'pg';
import type { Account } from './accounts.ts';
import { userColumnExists } from './addClient.ts';
import { ApiError } from './errors.ts';
import { gymOf, GYM_PEOPLE } from './invitations.ts';

type Queryable = Pick<pg.Pool, 'query'>;

type WaitingRow = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  fitness_goal: string | null;
  notes: string | null;
  coach_id: string;
  coach_name: string | null;
  created_at: Date;
};

const SELECT = `
  select w.id, w.email, w.full_name, w.phone, w.fitness_goal, w.notes, w.coach_id, p.full_name as coach_name, w.created_at
  from coach.waiting_clients w
  left join coach.profiles p on p.user_id = w.coach_id`;

const toSummary = (row: WaitingRow): ClientSummary => ({
  id: row.id,
  name: row.full_name,
  coachId: row.coach_id,
  coachName: row.coach_name,
  startedAt: row.created_at.toISOString(),
  lastLoggedAt: null,
  waiting: true,
});

/** The waiting client the viewer may see, or null (answered as not found). */
export async function findWaiting(db: Queryable, viewer: Account, id: string): Promise<WaitingRow | null> {
  const gym = await gymOf(db, viewer);
  if (!gym) return null;
  const { rows } = await db.query<WaitingRow>(`${SELECT} where w.id = $1 and w.gym_head_coach_id = $2 and ($3::boolean or w.coach_id = $4)`, [
    id,
    gym.headCoachId,
    viewer.roles.includes('head_coach'),
    viewer.id,
  ]);
  return rows[0] ?? null;
}

/** The viewer's waiting clients for the list, optionally filtered by search text and Coach. */
export async function listWaiting(db: Queryable, viewer: Account, filter: { q?: string | undefined; coachId?: string | undefined }): Promise<ClientSummary[]> {
  const gym = await gymOf(db, viewer);
  if (!gym) return [];
  const { rows } = await db.query<WaitingRow>(
    `${SELECT}
     where w.gym_head_coach_id = $1 and ($2::boolean or w.coach_id = $3)
       and ($4::text is null or w.email ilike '%' || $4 || '%' or w.full_name ilike '%' || $4 || '%')
       and ($5::uuid is null or w.coach_id = $5)
     order by lower(w.full_name)`,
    [gym.headCoachId, viewer.roles.includes('head_coach'), viewer.id, filter.q?.trim() || null, filter.coachId ?? null],
  );
  return rows.map(toSummary);
}

export async function waitingProfile(db: Queryable, viewer: Account, id: string): Promise<ClientProfile> {
  const row = await findWaiting(db, viewer, id);
  if (!row) throw new ApiError('NOT_FOUND');
  return {
    ...toSummary(row),
    latestWeightKg: null,
    targets: { calories: null, proteinG: null, weeklyWorkouts: null },
    workoutsThisWeek: 0,
    email: row.email,
    phone: row.phone,
    fitnessGoal: row.fitness_goal,
    notes: row.notes,
    isGymMember: false,
  };
}

export async function updateWaiting(
  db: Queryable,
  viewer: Account,
  id: string,
  input: { fullName: string; phone: string | null; fitnessGoal: string | null; notes: string | null },
): Promise<void> {
  const row = await findWaiting(db, viewer, id);
  if (!row) throw new ApiError('NOT_FOUND');
  await db.query(
    `update coach.waiting_clients set full_name = $2, phone = $3, fitness_goal = $4, notes = $5, updated_at = now(), updated_by = $6 where id = $1`,
    [id, input.fullName, input.phone, input.fitnessGoal, input.notes, viewer.id],
  );
}

/** Cancelling a waiting client deletes the row; they have no history yet. */
export async function removeWaiting(db: Queryable, viewer: Account, id: string): Promise<void> {
  const row = await findWaiting(db, viewer, id);
  if (!row) throw new ApiError('NOT_FOUND');
  await db.query('delete from coach.waiting_clients where id = $1', [id]);
}

/** The Head Coach moves a waiting client to another Coach of the gym, or to themselves (C-D21). */
export async function moveWaiting(db: Queryable, viewer: Account, id: string, coachId: string): Promise<void> {
  if (!viewer.roles.includes('head_coach')) throw new ApiError('NOT_PERMITTED');
  const row = await findWaiting(db, viewer, id);
  if (!row) throw new ApiError('NOT_FOUND');
  const { rowCount } = await db.query(`select 1 from (${GYM_PEOPLE}) people where id = $2`, [viewer.id, coachId]);
  if (!rowCount || coachId === row.coach_id) throw new ApiError('VALIDATION_FAILED', [{ field: 'coachId', issue: 'invalid_format' }]);
  await db.query('update coach.waiting_clients set coach_id = $2, updated_at = now(), updated_by = $3 where id = $1', [id, coachId, viewer.id]);
}

/**
 * Promotes the gym's waiting clients whose email now has a FitSphere account (see the top of this file).
 * Called when the gym's list or a profile is read. Needs a pool (a transaction); with a stand-in that only
 * has `query` it does nothing. A row that cannot be linked (already a client elsewhere, or gym staff) stays
 * waiting, and one bad row never stops the others.
 */
export async function linkWaitingClients(db: pg.Pool | Queryable, headCoachId: string): Promise<number> {
  if (!('connect' in db)) return 0;
  const { rows: ready } = await db.query<{ id: string; user_id: string }>(
    `select w.id, u.id as user_id
     from coach.waiting_clients w join app.users u on u.email = w.email
     where w.gym_head_coach_id = $1`,
    [headCoachId],
  );
  let linked = 0;
  const hasFlag = ready.length > 0 && (await userColumnExists(db, 'is_gym_member'));
  for (const item of ready) {
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`add-client:${item.user_id}`]);
      const { rows } = await client.query<{ coach_id: string; added_by: string; full_name: string; phone: string | null; fitness_goal: string | null; notes: string | null }>(
        'select coach_id, added_by, full_name, phone, fitness_goal, notes from coach.waiting_clients where id = $1 for update',
        [item.id],
      );
      const waiting = rows[0];
      const blocked = await client.query(
        `select 1 from app.links l where l.lower_user_id = $1 and l.kind = 'coach_trainee' and l.status = 'active'
         union all select 1 where $1::uuid in (select id from (${GYM_PEOPLE.replaceAll('$1', '$2')}) staff)`,
        [item.user_id, headCoachId],
      );
      if (!waiting || blocked.rowCount) {
        await client.query('rollback');
        continue;
      }
      await client.query(
        `insert into coach.gym_clients (client_id, gym_head_coach_id, added_by, full_name, phone, fitness_goal, notes, is_gym_member)
         values ($1, $2, $3, $4, $5, $6, $7, true)
         on conflict (client_id) do update set full_name = excluded.full_name, phone = excluded.phone,
           fitness_goal = excluded.fitness_goal, notes = excluded.notes, gym_head_coach_id = excluded.gym_head_coach_id, is_gym_member = true`,
        [item.user_id, headCoachId, waiting.added_by, waiting.full_name, waiting.phone, waiting.fitness_goal, waiting.notes],
      );
      await client.query(`insert into app.links (kind, upper_user_id, lower_user_id, status, started_at) values ('coach_trainee', $1, $2, 'active', now())`, [
        waiting.coach_id,
        item.user_id,
      ]);
      if (hasFlag) await client.query('update app.users set is_gym_member = true where id = $1', [item.user_id]);
      await client.query('delete from coach.waiting_clients where id = $1', [item.id]);
      await client.query('commit');
      linked += 1;
    } catch {
      await client.query('rollback').catch(() => undefined);
    } finally {
      client.release();
    }
  }
  return linked;
}
