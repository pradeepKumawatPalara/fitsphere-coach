// Calendar (CF09, SPEC-004): a client's active workout or diet plan scheduled on India days.
//
// Who sees and changes what (invariants 1, 14): a Coach works with their own clients' calendars, the Head
// Coach with the whole gym's; anything else is "not found". A workout needs the client's active training
// plan and a diet plan the client's active diet plan (SPEC-004 rules 2 and 3); drafts cannot be scheduled.
//
// Status (SPEC-004 §4.6, owner-assumed rules, to confirm):
// - completed: a coach marked it, or (workout) the client logged a workout that day in the FitSphere app,
//   or (nutrition) its last day has passed;
// - missed: a workout whose day has passed and is not completed (worked out when read, never stored);
// - rescheduled: moved at least once and still to come; otherwise assigned.
// Conflicts (the same client, a workout on the same day at the same time) warn and never block.
import {
  addDays,
  daysBetween,
  MAX_CALENDAR_SPAN_DAYS,
  MAX_NUTRITION_DAYS,
  workoutDates,
  type ActivityDetail,
  type ActivityHistoryItem,
  type ActivityStatus,
  type CalendarActivity,
  type CalendarOptions,
  type CalendarResponse,
  type MoveActivityRequest,
  type PlanContent,
  type ScheduleNutritionRequest,
  type SchedulePreview,
  type ScheduleResult,
  type ScheduleWorkoutRequest,
} from '@fitsphere-coach/shared';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Account } from './accounts.ts';
import { isHeadCoach, VISIBLE_UPPERS } from './clients.ts';
import { ApiError } from './errors.ts';
import { transaction } from './plans.ts';
import { gymOf, NOT_FOUND, roleOf } from './workouts.ts';

type Queryable = Pick<pg.Pool, 'query'>;
type Request = ScheduleWorkoutRequest;

const TODAY = `(now() at time zone 'Asia/Kolkata')::date`;
const today = async (db: Queryable): Promise<string> => ((await db.query<{ d: string }>(`select (${TODAY})::text as d`)).rows[0] as { d: string }).d;

type Row = {
  id: string;
  kind: CalendarActivity['kind'];
  trainee_id: string;
  trainee_name: string;
  coach_id: string;
  coach_name: string | null;
  title: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  time: string | null;
  notes: string;
  status: ActivityStatus;
};

// The activity with its client's current coach, only when the viewer may see that client ($1 viewer,
// $2 whether the viewer is the Head Coach). The status is worked out here, in India days.
const SELECT = `
  select a.id, a.kind, a.trainee_id,
         coalesce(nullif(to_jsonb(u) ->> 'full_name', ''), u.email) as trainee_name,
         l.upper_user_id as coach_id, cp.full_name as coach_name,
         a.title, a.plan_name, to_char(a.start_date, 'YYYY-MM-DD') as start_date, to_char(a.end_date, 'YYYY-MM-DD') as end_date,
         to_char(a.time_of_day, 'HH24:MI') as time, a.notes,
         case
           when a.status = 'completed' then 'completed'
           when a.kind = 'workout' and exists (select 1 from app.workouts w where w.user_id = a.trainee_id and w.day = a.start_date and w.deleted_at is null) then 'completed'
           when a.kind = 'nutrition' and a.end_date < ${TODAY} then 'completed'
           when a.kind = 'workout' and a.start_date < ${TODAY} then 'missed'
           when a.moves > 0 then 'rescheduled'
           else 'assigned'
         end as status
  from coach.calendar_activities a
  join app.links l on l.lower_user_id = a.trainee_id and l.kind = 'coach_trainee' and l.status = 'active'
       and l.upper_user_id in (${VISIBLE_UPPERS})
  join app.users u on u.id = a.trainee_id
  left join coach.profiles cp on cp.user_id = l.upper_user_id
  where a.status <> 'removed'`;

const toActivity = (row: Row): CalendarActivity => ({
  id: row.id,
  kind: row.kind,
  traineeId: row.trainee_id,
  traineeName: row.trainee_name,
  coachId: row.coach_id,
  coachName: row.coach_name,
  title: row.title,
  planName: row.plan_name,
  startDate: row.start_date,
  endDate: row.end_date,
  time: row.time,
  notes: row.notes,
  status: row.status,
});

async function findActivity(db: Queryable, viewer: Account, id: string): Promise<Row> {
  const { rows } = await db.query<Row>(`${SELECT} and a.id = $3`, [viewer.id, isHeadCoach(viewer), id]);
  if (!rows[0]) throw NOT_FOUND();
  return rows[0];
}

/** The client must be one the viewer may see (a Coach: their own; the Head Coach: the gym's). */
async function requireClient(db: Queryable, viewer: Account, traineeId: string): Promise<void> {
  const { rowCount } = await db.query(
    `select 1 from app.links l where l.kind = 'coach_trainee' and l.status = 'active' and l.lower_user_id = $3 and l.upper_user_id in (${VISIBLE_UPPERS})`,
    [viewer.id, isHeadCoach(viewer), traineeId],
  );
  if (!rowCount) throw NOT_FOUND();
}

const trainingDayIndexes = (content: PlanContent): number[] => content.days.flatMap((day, index) => (day.rest ? [] : [index]));

async function activeTrainingPlan(db: Queryable, traineeId: string, planId: string): Promise<{ name: string; content: PlanContent }> {
  const { rows } = await db.query<{ name: string; content: PlanContent }>(`select name, content from coach.training_plans where id = $1 and trainee_id = $2 and status = 'active'`, [planId, traineeId]);
  if (!rows[0]) throw NOT_FOUND();
  return rows[0];
}
async function activeDietPlan(db: Queryable, traineeId: string, planId: string): Promise<{ name: string }> {
  const { rows } = await db.query<{ name: string }>(`select name from coach.diet_plans where id = $1 and trainee_id = $2 and status = 'active'`, [planId, traineeId]);
  if (!rows[0]) throw NOT_FOUND();
  return rows[0];
}

const invalid = (field: string, issue: 'out_of_range' | 'invalid_format' = 'out_of_range') => new ApiError('VALIDATION_FAILED', [{ field, issue }]);

async function log(tx: Queryable, activityId: string, viewer: Account, action: ActivityHistoryItem['action'], fromDate: string | null, toDate: string | null, reason: string | null = null) {
  await tx.query(
    `insert into coach.calendar_changes (activity_id, action, from_date, to_date, reason, actor_id, actor_role) values ($1, $2, $3, $4, $5, $6, $7)`,
    [activityId, action, fromDate, toDate, reason || null, viewer.id, roleOf(viewer)],
  );
}

// --- Reading ---

export async function listCalendar(
  db: Queryable,
  viewer: Account,
  range: { from: string; to: string; traineeId?: string | undefined; coachId?: string | undefined },
): Promise<CalendarResponse> {
  if (range.to < range.from || daysBetween(range.from, range.to) > MAX_CALENDAR_SPAN_DAYS) throw invalid('to');
  const head = isHeadCoach(viewer);
  const { rows } = await db.query<Row>(
    `${SELECT}
       and a.start_date <= $4 and a.end_date >= $3
       and ($5::uuid is null or a.trainee_id = $5) and ($6::uuid is null or l.upper_user_id = $6)
     order by a.start_date, a.time_of_day nulls last, a.created_at`,
    [viewer.id, head, range.from, range.to, range.traineeId ?? null, range.coachId ?? null],
  );
  const coaches = head
    ? (
        await db.query<{ id: string; full_name: string | null }>(
          `select l.lower_user_id as id, p.full_name from app.links l left join coach.profiles p on p.user_id = l.lower_user_id
           where l.kind = 'head_coach_coach' and l.status = 'active' and l.upper_user_id = $1 order by lower(coalesce(p.full_name, ''))`,
          [viewer.id],
        )
      ).rows.map((row) => ({ id: row.id, name: row.full_name }))
    : [];
  return { activities: rows.map(toActivity), coaches };
}

export async function getActivity(db: Queryable, viewer: Account, id: string): Promise<ActivityDetail> {
  const row = await findActivity(db, viewer, id);
  const { rows } = await db.query<{
    action: ActivityHistoryItem['action']; from_date: string | null; to_date: string | null; reason: string | null;
    actor_name: string | null; actor_role: ActivityHistoryItem['actorRole']; created_at: Date;
  }>(
    `select c.action, to_char(c.from_date, 'YYYY-MM-DD') as from_date, to_char(c.to_date, 'YYYY-MM-DD') as to_date, c.reason,
            p.full_name as actor_name, c.actor_role, c.created_at
     from coach.calendar_changes c left join coach.profiles p on p.user_id = c.actor_id
     where c.activity_id = $1 order by c.created_at, c.id`,
    [id],
  );
  return {
    ...toActivity(row),
    history: rows.map((r) => ({ action: r.action, fromDate: r.from_date, toDate: r.to_date, reason: r.reason, actorName: r.actor_name, actorRole: r.actor_role, at: r.created_at.toISOString() })),
  };
}

/** What can be scheduled for a client: their active workout plan (with its training days) and diet plan. */
export async function calendarOptions(db: Queryable, viewer: Account, traineeId: string): Promise<CalendarOptions> {
  await requireClient(db, viewer, traineeId);
  const workout = await db.query<{ id: string; name: string; content: PlanContent }>(`select id, name, content from coach.training_plans where trainee_id = $1 and status = 'active'`, [traineeId]);
  const diet = await db.query<{ id: string; name: string }>(`select id, name from coach.diet_plans where trainee_id = $1 and status = 'active'`, [traineeId]);
  const plan = workout.rows[0];
  return {
    workoutPlan: plan ? { id: plan.id, name: plan.name, days: plan.content.days.flatMap((day, index) => (day.rest ? [] : [{ index, name: day.name }])) } : null,
    dietPlan: diet.rows[0] ?? null,
  };
}

// --- Scheduling ---

async function planWorkoutDates(db: Queryable, viewer: Account, request: Request) {
  await requireClient(db, viewer, request.traineeId);
  const plan = await activeTrainingPlan(db, request.traineeId, request.planId);
  const training = trainingDayIndexes(plan.content);
  if (!training.includes(request.dayIndex)) throw invalid('dayIndex');
  if (request.date < (await today(db))) throw invalid('date');
  const dates = workoutDates({ date: request.date, dayIndex: request.dayIndex, repeat: request.repeat, skipDates: request.skipDates }, training);
  if (dates.length === 0) throw invalid('repeat');
  // Conflicts: the same client already has a workout that day at the same time (no time counts as one time).
  const { rows } = await db.query<{ day: string }>(
    `select distinct to_char(start_date, 'YYYY-MM-DD') as day from coach.calendar_activities
     where trainee_id = $1 and kind = 'workout' and status <> 'removed' and start_date = any($2::date[])
       and time_of_day is not distinct from $3::time`,
    [request.traineeId, dates.map((d) => d.date), request.time],
  );
  const conflicts = new Set(rows.map((row) => row.day));
  return { plan, dates, conflicts };
}

export async function previewWorkout(db: Queryable, viewer: Account, request: Request): Promise<SchedulePreview> {
  const { plan, dates, conflicts } = await planWorkoutDates(db, viewer, request);
  return { dates: dates.map((d) => ({ date: d.date, dayIndex: d.dayIndex, dayName: plan.content.days[d.dayIndex]?.name ?? '', conflict: conflicts.has(d.date) })) };
}

export async function scheduleWorkout(db: pg.Pool, viewer: Account, request: Request): Promise<ScheduleResult> {
  const gym = await gymOf(db, viewer);
  const { plan, dates, conflicts } = await planWorkoutDates(db, viewer, request);
  const series = dates.length > 1 ? randomUUID() : null;
  await transaction(db, async (tx) => {
    for (const planned of dates) {
      const { rows } = await tx.query<{ id: string }>(
        `insert into coach.calendar_activities (trainee_id, gym_head_coach_id, created_by, kind, training_plan_id, day_index, title, plan_name, start_date, end_date, time_of_day, notes, series_id)
         values ($1, $2, $3, 'workout', $4, $5, $6, $7, $8, $8, $9, $10, $11) returning id`,
        [request.traineeId, gym, viewer.id, request.planId, planned.dayIndex, plan.content.days[planned.dayIndex]?.name ?? plan.name, plan.name, planned.date, request.time, request.notes, series],
      );
      await log(tx, (rows[0] as { id: string }).id, viewer, 'scheduled', null, planned.date);
    }
  });
  return { count: dates.length, conflicts: [...conflicts].sort() };
}

/**
 * A diet plan on a range of days. A diet plan already scheduled for the same client on some of those days
 * gives way: one that starts before the new range is cut short the day before it, one that starts inside
 * the range is removed (a warning, never a block, SPEC-004 §4.8).
 */
export async function scheduleNutrition(db: pg.Pool, viewer: Account, request: ScheduleNutritionRequest): Promise<ScheduleResult> {
  const gym = await gymOf(db, viewer);
  await requireClient(db, viewer, request.traineeId);
  const plan = await activeDietPlan(db, request.traineeId, request.planId);
  if (request.from < (await today(db))) throw invalid('from');
  if (request.to < request.from || daysBetween(request.from, request.to) + 1 > MAX_NUTRITION_DAYS) throw invalid('to');
  const conflicts: string[] = [];
  await transaction(db, async (tx) => {
    const { rows: overlaps } = await tx.query<{ id: string; start_date: string }>(
      `select id, to_char(start_date, 'YYYY-MM-DD') as start_date from coach.calendar_activities
       where trainee_id = $1 and kind = 'nutrition' and status <> 'removed' and start_date <= $3 and end_date >= $2 for update`,
      [request.traineeId, request.from, request.to],
    );
    for (const old of overlaps) {
      if (old.start_date < request.from) {
        await tx.query(`update coach.calendar_activities set end_date = $2, updated_at = now() where id = $1`, [old.id, addDays(request.from, -1)]);
      } else {
        await tx.query(`update coach.calendar_activities set status = 'removed', updated_at = now() where id = $1`, [old.id]);
        await log(tx, old.id, viewer, 'removed', old.start_date, null, 'Replaced by a new diet schedule');
      }
      conflicts.push(old.start_date);
    }
    const { rows } = await tx.query<{ id: string }>(
      `insert into coach.calendar_activities (trainee_id, gym_head_coach_id, created_by, kind, diet_plan_id, title, plan_name, start_date, end_date, notes)
       values ($1, $2, $3, 'nutrition', $4, $5, $5, $6, $7, $8) returning id`,
      [request.traineeId, gym, viewer.id, request.planId, plan.name, request.from, request.to, request.notes],
    );
    await log(tx, (rows[0] as { id: string }).id, viewer, 'scheduled', null, request.from);
  });
  return { count: 1, conflicts: conflicts.sort() };
}

// --- Changing ---

export async function moveActivity(db: pg.Pool, viewer: Account, id: string, request: MoveActivityRequest): Promise<ActivityDetail> {
  await transaction(db, async (tx) => {
    const row = await findActivity(tx, viewer, id);
    if (row.status === 'completed') throw new ApiError('NOT_PERMITTED');
    if (request.date < (await today(tx))) throw invalid('date');
    if (row.kind === 'nutrition' && request.time !== null) throw invalid('time', 'invalid_format');
    const length = daysBetween(row.start_date, row.end_date);
    await tx.query(
      `update coach.calendar_activities set start_date = $2, end_date = $3, time_of_day = $4, moves = moves + 1, updated_at = now() where id = $1`,
      [id, request.date, addDays(request.date, length), request.time],
    );
    await log(tx, id, viewer, 'moved', row.start_date, request.date, request.reason);
  });
  return getActivity(db, viewer, id);
}

/** A coach marks an activity done (the client's own log counts without this). */
export async function completeActivity(db: pg.Pool, viewer: Account, id: string): Promise<ActivityDetail> {
  await transaction(db, async (tx) => {
    const row = await findActivity(tx, viewer, id);
    if (row.status === 'completed') return;
    await tx.query(`update coach.calendar_activities set status = 'completed', completed_at = now(), completed_by = $2, updated_at = now() where id = $1`, [id, viewer.id]);
    await log(tx, id, viewer, 'completed', row.start_date, null);
  });
  return getActivity(db, viewer, id);
}

export async function removeActivity(db: pg.Pool, viewer: Account, id: string): Promise<void> {
  await transaction(db, async (tx) => {
    const row = await findActivity(tx, viewer, id);
    // A removed activity keeps its history; the "done" mark goes with it (the table ties the two together).
    await tx.query(`update coach.calendar_activities set status = 'removed', completed_at = null, completed_by = null, updated_at = now() where id = $1`, [id]);
    await log(tx, id, viewer, 'removed', row.start_date, null);
  });
}
