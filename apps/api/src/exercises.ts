// The exercise library for workout plans (CF06). Read only: `app.exercises` and `app.exercise_details`
// belong to the trainee app (shared database contract, rule 4), so this module only selects.
// 100 of the 2,119 exercises have no details row, hence the left join; their category, muscle and
// equipment are null. Search matches the name and the aliases.
import {
  EXERCISE_PAGE_SIZE,
  MAX_EXERCISE_LOOKUP,
  type ExerciseDetail,
  type ExerciseFiltersResponse,
  type ExerciseListResponse,
  type ExerciseSummary,
  type PlanContent,
} from '@fitsphere-coach/shared';
import type pg from 'pg';
import { ApiError } from './errors.ts';

type Queryable = Pick<pg.Pool, 'query'>;

type SummaryRow = {
  code: string;
  name: string;
  exercise_group: string;
  log_type: string;
  category: string | null;
  primary_muscle: string | null;
  equipment: string | null;
};

// Some exercises have more than one details row; the first (by library_row) is used, so every exercise
// appears once and the counts are exact.
const DETAILS = `left join lateral (select * from app.exercise_details x where x.exercise_code = e.code order by x.library_row limit 1) d on true`;

const SELECT = `
  select e.code, e.name, e.exercise_group, e.log_type, d.category, d.primary_muscle, d.equipment
  from app.exercises e
  ${DETAILS}`;

const toSummary = (row: SummaryRow): ExerciseSummary => ({
  code: row.code,
  name: row.name,
  group: row.exercise_group,
  category: row.category,
  primaryMuscle: row.primary_muscle,
  equipment: row.equipment,
  logType: row.log_type,
});

export type ExerciseQuery = {
  q?: string | undefined;
  category?: string | undefined;
  muscle?: string | undefined;
  equipment?: string | undefined;
  group?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

/** Escapes `%`, `_` and `\` so the coach's search text is matched literally by `ilike`. */
const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const WHERE = `
  where ($1::text is null or e.name ilike '%' || $1 || '%' or exists (select 1 from unnest(e.aliases) a where a ilike '%' || $1 || '%'))
    and ($2::text is null or d.category = $2)
    and ($3::text is null or d.primary_muscle = $3)
    and ($4::text is null or d.equipment = $4)
    and ($5::text is null or e.exercise_group = $5)`;

export async function searchExercises(db: Queryable, query: ExerciseQuery): Promise<ExerciseListResponse> {
  const params = [
    query.q?.trim() ? literal(query.q.trim()) : null,
    query.category ?? null,
    query.muscle ?? null,
    query.equipment ?? null,
    query.group ?? null,
  ];
  const limit = Math.min(Math.max(query.limit ?? EXERCISE_PAGE_SIZE, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  const { rows } = await db.query<SummaryRow>(`${SELECT} ${WHERE} order by lower(e.name), e.code limit $6 offset $7`, [...params, limit, offset]);
  const { rows: count } = await db.query<{ n: number }>(
    `select count(*)::int as n from app.exercises e ${DETAILS} ${WHERE}`,
    params,
  );
  return { exercises: rows.map(toSummary), total: count[0]?.n ?? 0 };
}

/** Names for a plan's exercises, in one call. Unknown codes are left out. */
export async function lookupExercises(db: Queryable, codes: string[]): Promise<ExerciseSummary[]> {
  const unique = [...new Set(codes)].slice(0, MAX_EXERCISE_LOOKUP);
  if (unique.length === 0) return [];
  const { rows } = await db.query<SummaryRow>(`${SELECT} where e.code = any($1::text[]) order by lower(e.name)`, [unique]);
  return rows.map(toSummary);
}

type DetailRow = SummaryRow & {
  sub_group: string | null;
  muscles_worked: string[] | null;
  tags: string[] | null;
  how_to: string[] | null;
  watch_for: string | null;
  video_url: string | null;
};

const DETAIL_SELECT = `
  select e.code, e.name, e.exercise_group, e.log_type, d.category, d.primary_muscle, d.equipment,
         d.sub_group, d.muscles_worked, d.tags, d.how_to, d.watch_for, d.video_url
  from app.exercises e ${DETAILS}`;

const toDetail = (row: DetailRow): ExerciseDetail => ({
  ...toSummary(row),
  subGroup: row.sub_group,
  musclesWorked: row.muscles_worked ?? [],
  tags: row.tags ?? [],
  steps: row.how_to ?? [],
  watchFor: row.watch_for || null,
  videoUrl: row.video_url,
});

export async function exerciseDetail(db: Queryable, code: string): Promise<ExerciseDetail> {
  const { rows } = await db.query<DetailRow>(`${DETAIL_SELECT} where e.code = $1`, [code]);
  const row = rows[0];
  if (!row) throw new ApiError('NOT_FOUND');
  return toDetail(row);
}

/** The values the picker's filter chips show, with how many exercises each has. */
export async function exerciseFilters(db: Queryable): Promise<ExerciseFiltersResponse> {
  const options = async (column: string, table: 'd' | 'e') => {
    const { rows } = await db.query<{ value: string; count: number }>(
      `select ${table}.${column} as value, count(*)::int as count
       from app.exercises e ${DETAILS}
       where ${table}.${column} is not null group by 1 order by 2 desc, 1`,
    );
    return rows;
  };
  return {
    categories: await options('category', 'd'),
    muscles: await options('primary_muscle', 'd'),
    equipment: await options('equipment', 'd'),
    groups: await options('exercise_group', 'e'),
  };
}

/** A plan may only use exercises that exist in the library (replaces the old fixed list). */
export async function assertExercisesExist(db: Queryable, content: PlanContent): Promise<void> {
  const codes = [...new Set(content.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseId)))];
  if (codes.length === 0) return;
  const { rows } = await db.query<{ code: string }>('select code from app.exercises where code = any($1::text[])', [codes]);
  if (rows.length !== codes.length) throw new ApiError('VALIDATION_FAILED', [{ field: 'content.days', issue: 'invalid_format' }]);
}

/** Full details for a plan's exercises, in one query. Unknown codes are left out. */
export async function exerciseDetails(db: Queryable, codes: string[]): Promise<Map<string, ExerciseDetail>> {
  const unique = [...new Set(codes)];
  const result = new Map<string, ExerciseDetail>();
  if (unique.length === 0) return result;
  const { rows } = await db.query<DetailRow>(`${DETAIL_SELECT} where e.code = any($1::text[])`, [unique]);
  for (const row of rows) result.set(row.code, toDetail(row));
  return result;
}
