// The food list for diet plans (CF07). Read only: `app.foods`, `app.food_portions` and `app.food_measures`
// belong to the trainee app (shared database contract, rule 4), so this module only selects.
// Values are per 100 g. Hidden foods and foods that need review are left out, as in the trainee app.
// Search matches the name and the aliases. A food's servings are its rows in food_portions (label and grams)
// and food_measures (one teaspoon, katori ... in grams).
import { FOOD_PAGE_SIZE, foodById, type Food, type FoodGroupsResponse, type FoodListResponse } from '@fitsphere-coach/shared';
import type pg from 'pg';

type Queryable = Pick<pg.Pool, 'query'>;

type FoodRow = {
  id: string;
  name: string;
  food_group: string;
  kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  fibre_g: string | null;
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS = 'f.id, f.name, f.food_group, f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fibre_g';
const VISIBLE = 'not f.hidden and not f.needs_review';

/** Escapes `%`, `_` and `\` so the coach's search text is matched literally by `ilike`. */
const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const WHERE = `
  where ${VISIBLE}
    and ($1::text is null or f.name ilike '%' || $1 || '%' or exists (select 1 from unnest(f.aliases) a where a ilike '%' || $1 || '%'))
    and ($2::text is null or f.food_group = $2)`;

/** Foods whose name starts with the search text come first, then the rest by name. */
const ORDER = `order by (case when $1::text is not null and f.name ilike $1 || '%' then 0 else 1 end), lower(f.name), f.code`;

const num = (value: string | null): number => (value === null ? 0 : Number(value));

async function withPortions(db: Queryable, rows: FoodRow[]): Promise<Food[]> {
  const portions = new Map<string, { label: string; grams: number }[]>();
  if (rows.length > 0) {
    const { rows: found } = await db.query<{ id: string; label: string; grams: string }>(
      `select f.id, p.label, p.grams from app.food_portions p join app.foods f on f.source = p.source and f.code = p.code
         where f.id = any($1::uuid[]) order by p.seq`,
      [rows.map((row) => row.id)],
    );
    for (const row of found) portions.set(row.id, [...(portions.get(row.id) ?? []), { label: row.label, grams: num(row.grams) }]);
    const { rows: measures } = await db.query<{ id: string; measure: string; grams: string }>(
      `select f.id, m.measure, m.grams from app.food_measures m join app.foods f on f.source = m.source and f.code = m.code
         where f.id = any($1::uuid[]) order by m.grams`,
      [rows.map((row) => row.id)],
    );
    for (const row of measures) portions.set(row.id, [...(portions.get(row.id) ?? []), { label: `1 ${row.measure}`, grams: num(row.grams) }]);
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    group: row.food_group,
    per100g: { kcal: num(row.kcal), proteinG: num(row.protein_g), carbsG: num(row.carbs_g), fatG: num(row.fat_g), fibreG: num(row.fibre_g) },
    portions: portions.get(row.id) ?? [],
  }));
}

export type FoodQuery = { q?: string | undefined; group?: string | undefined; limit?: number | undefined; offset?: number | undefined };

export async function searchFoods(db: Queryable, query: FoodQuery): Promise<FoodListResponse> {
  const params = [query.q?.trim() ? literal(query.q.trim()) : null, query.group ?? null];
  const limit = Math.min(Math.max(query.limit ?? FOOD_PAGE_SIZE, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  const { rows } = await db.query<FoodRow>(`select ${COLUMNS} from app.foods f ${WHERE} ${ORDER} limit $3 offset $4`, [...params, limit, offset]);
  const { rows: count } = await db.query<{ n: number }>(`select count(*)::int as n from app.foods f ${WHERE}`, params);
  return { foods: await withPortions(db, rows), total: count[0]?.n ?? 0 };
}

/** The values the picker's group filter shows, with how many foods each has. */
export async function foodGroups(db: Queryable): Promise<FoodGroupsResponse> {
  const { rows } = await db.query<{ value: string; count: number }>(
    `select f.food_group as value, count(*)::int as count from app.foods f where ${VISIBLE} group by 1 order by 2 desc, 1`,
  );
  return { groups: rows };
}

/**
 * The foods a plan uses, by id: UUIDs from app.foods, and the ten starter ids of plans saved before the
 * food table was used. An id that is in neither is left out of the map.
 */
export async function lookupFoods(db: Queryable, ids: string[]): Promise<Map<string, Food>> {
  const result = new Map<string, Food>();
  const unique = [...new Set(ids)];
  const uuids = unique.filter((id) => UUID.test(id));
  for (const id of unique) {
    const starter = foodById(id);
    if (starter) result.set(id, starter);
  }
  if (uuids.length > 0) {
    const { rows } = await db.query<FoodRow>(`select ${COLUMNS} from app.foods f where f.id = any($1::uuid[]) and ${VISIBLE}`, [uuids]);
    for (const food of await withPortions(db, rows)) result.set(food.id, food);
  }
  return result;
}
