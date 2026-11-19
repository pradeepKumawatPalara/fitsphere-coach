// What a client logged in the FitSphere app, for the coach to see (CF04, owner request 2026-11-12). Read only:
// `app.meals` and `app.targets` belong to the trainee app (shared database contract, rule 4), so this module only
// selects. Access is the same as the client profile (invariant 1): a Coach sees their own clients, the Head Coach
// the gym's, anything else (and a client still waiting for a FitSphere account) is "not found". Meal data is health
// data: never logged here (invariant 6).
//
// Photos: a meal's photo is either a public link (shown as a link) or a stored file in the private `meal-photos`
// bucket. Stored files need a signed link that only the trainee API (or a Supabase secret key) can issue, which
// this repo does not have, so a stored photo is reported as `stored` and the app says it cannot be shown yet.
//
// Targets are stored per day. The target in force on a day is the latest one set on or before that day.
import type { ClientNutritionResponse, NutritionMeal } from '@fitsphere-coach/shared';
import type pg from 'pg';
import type { Account } from './accounts.ts';
import { findClient } from './clients.ts';
import { ApiError } from './errors.ts';

type Queryable = Pick<pg.Pool, 'query'>;

const TODAY = `(now() at time zone 'Asia/Kolkata')::date::text`;
const num = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

function toMeal(row: {
  id: string;
  meal_type: string;
  kcal: string | null;
  protein_g: string | null;
  carbs_g: string | null;
  fat_g: string | null;
  fibre_g: string | null;
  items: unknown;
  photo: unknown;
  recorded_at: Date;
}): NutritionMeal {
  const items = (Array.isArray(row.items) ? row.items : []).flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const i = item as Record<string, unknown>;
    if (typeof i.name !== 'string') return [];
    const amount = typeof i.amount === 'object' && i.amount !== null ? (i.amount as Record<string, unknown>) : null;
    return [
      {
        name: i.name,
        amount: amount && num(amount.value) !== null && typeof amount.unit === 'string' ? { value: num(amount.value) as number, unit: amount.unit } : null,
        kcal: num(i.kcal),
        proteinG: num(i.proteinG),
        carbsG: num(i.carbsG),
        fatG: num(i.fatG),
        estimated: i.estimated === true,
      },
    ];
  });
  const photo = typeof row.photo === 'object' && row.photo !== null ? (row.photo as Record<string, unknown>) : null;
  const link = photo?.kind === 'link' && typeof photo.url === 'string' && /^https?:\/\//i.test(photo.url) ? photo.url : null;
  return {
    id: row.id,
    mealType: row.meal_type,
    recordedAt: row.recorded_at.toISOString(),
    kcal: num(row.kcal),
    proteinG: num(row.protein_g),
    carbsG: num(row.carbs_g),
    fatG: num(row.fat_g),
    fibreG: num(row.fibre_g),
    items,
    photo: link ? { kind: 'link', url: link } : photo?.kind === 'photo' ? { kind: 'stored' } : null,
  };
}

export async function clientNutrition(db: Queryable, viewer: Account, traineeId: string, day?: string): Promise<ClientNutritionResponse> {
  const client = await findClient(db, viewer, traineeId);
  if (!client) throw new ApiError('NOT_FOUND');
  const chosen = day ?? ((await db.query<{ d: string }>(`select ${TODAY} as d`)).rows[0] as { d: string }).d;

  const { rows: meals } = await db.query<Parameters<typeof toMeal>[0]>(
    `select id, meal_type, kcal, protein_g, carbs_g, fat_g, fibre_g, items, photo, recorded_at
     from app.meals where user_id = $1 and day = $2::date and deleted_at is null order by recorded_at`,
    [traineeId, chosen],
  );

  const { rows: targets } = await db.query<{ kind: string; value: number }>(
    `select distinct on (kind) kind, value from app.targets
     where user_id = $1 and kind in ('calories', 'protein', 'carbs', 'fat', 'fibre') and (day is null or day <= $2::date)
     order by kind, day desc nulls last, set_at desc`,
    [traineeId, chosen],
  );
  const target = (kind: string) => targets.find((row) => row.kind === kind)?.value ?? null;

  const { rows: week } = await db.query<{ day: string; kcal: string | null; meals: number }>(
    `select day::text as day, sum(kcal) as kcal, count(*)::int as meals
     from app.meals where user_id = $1 and deleted_at is null and day between ($2::date - 6) and $2::date
     group by day order by day desc`,
    [traineeId, chosen],
  );

  const mapped = meals.map(toMeal);
  const sum = (pick: (meal: NutritionMeal) => number | null) => Math.round(mapped.reduce((total, meal) => total + (pick(meal) ?? 0), 0) * 10) / 10;
  return {
    day: chosen,
    totals: { kcal: sum((m) => m.kcal), proteinG: sum((m) => m.proteinG), carbsG: sum((m) => m.carbsG), fatG: sum((m) => m.fatG), fibreG: sum((m) => m.fibreG) },
    targets: { kcal: target('calories'), proteinG: target('protein'), carbsG: target('carbs'), fatG: target('fat'), fibreG: target('fibre') },
    meals: mapped,
    week: week.map((row) => ({ day: row.day, kcal: num(row.kcal) === null ? null : Math.round(num(row.kcal) as number), meals: row.meals })),
  };
}
