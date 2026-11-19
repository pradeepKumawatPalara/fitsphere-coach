// Nutrition management (CF07, SPEC-003): diet templates and diet plans.
// A coach sends only which food, how many grams, a label and the protein-source mark; the server fills
// in the name and the nutrition from app.foods (values per 100 g), so a plan's totals cannot be made
// up by the app. A plan is a fitness planning tool, not medical advice (SPEC-003 rule 7).
import { z } from 'zod';
import { idSchema } from './contracts.ts';
import type { PlanChange, PlanStatus } from './workouts.ts';

export const DIET_GOALS = ['weight_loss', 'muscle_gain', 'maintenance', 'general_fitness'] as const;
/** The four meal types the FitSphere app logs; a custom slot "logs as" one of them. */
export const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MAX_SLOTS = 8;
export const MAX_OPTIONS = 3;
export const MAX_INGREDIENTS = 15;
export const DIET_DISCLAIMER = 'A fitness planning tool. It is not medical advice.';
/** A plan more than this far (as a share) from a target gets a warning, never a block. */
export const OFF_TARGET_WARNING = 0.1;

// --- The food list is FitSphere's own (app.foods with app.food_portions and app.food_measures, read only,
// nutrition per 100 g). The app searches it through GET /v1/foods. The ten starter foods below are kept
// only so that plans saved before the food table was used keep working (their ids are not UUIDs). ---

export type Nutrition = { kcal: number; proteinG: number; carbsG: number; fatG: number; fibreG: number };
export type Food = { id: string; name: string; group: string; per100g: Nutrition; portions: { label: string; grams: number }[] };

const n = (kcal: number, proteinG: number, carbsG: number, fatG: number, fibreG: number): Nutrition => ({ kcal, proteinG, carbsG, fatG, fibreG });

export const FOODS: readonly Food[] = [
  { id: 'paneer', name: 'Paneer', group: 'Milk products', per100g: n(265, 18.3, 1.2, 20.8, 0), portions: [{ label: '1 slice', grams: 25 }] },
  { id: 'chicken-breast', name: 'Chicken breast', group: 'Meat and poultry', per100g: n(120, 22.5, 0, 2.6, 0), portions: [{ label: '1 piece', grams: 100 }] },
  { id: 'egg-whole', name: 'Egg, whole', group: 'Eggs', per100g: n(143, 12.6, 0.7, 9.5, 0), portions: [{ label: '1 egg', grams: 50 }] },
  { id: 'toor-dal-cooked', name: 'Toor dal, cooked', group: 'Pulses', per100g: n(116, 6.8, 20, 1, 3), portions: [{ label: '1 katori', grams: 150 }] },
  { id: 'wheat-roti', name: 'Wheat roti', group: 'Cereals', per100g: n(297, 11, 50, 4, 3), portions: [{ label: '1 roti', grams: 40 }] },
  { id: 'rice-cooked', name: 'Rice, cooked', group: 'Cereals', per100g: n(130, 2.7, 28, 0.3, 0.4), portions: [{ label: '1 katori', grams: 150 }] },
  { id: 'oats', name: 'Oats', group: 'Cereals', per100g: n(379, 13.2, 67, 6.5, 10), portions: [{ label: '1 bowl, dry', grams: 40 }] },
  { id: 'whey-protein', name: 'Whey protein powder', group: 'Supplements', per100g: n(400, 80, 8, 6, 0), portions: [{ label: '1 scoop', grams: 30 }] },
  { id: 'banana', name: 'Banana', group: 'Fruits', per100g: n(89, 1.1, 23, 0.3, 2.6), portions: [{ label: '1 medium', grams: 118 }] },
  { id: 'curd', name: 'Curd (dahi)', group: 'Milk products', per100g: n(61, 3.5, 4.7, 3.3, 0), portions: [{ label: '1 katori', grams: 150 }] },
];
export const FOOD_PAGE_SIZE = 30;
export type FoodListResponse = { foods: Food[]; total: number };
export type FoodGroupsResponse = { groups: { value: string; count: number }[] };
export const foodById = (id: string): Food | undefined => FOODS.find((food) => food.id === id);

const round1 = (value: number) => Math.round(value * 10) / 10;

/** The nutrition of `grams` of a food, rounded to one decimal. */
export function nutritionFor(food: Food, grams: number): Nutrition {
  const scale = grams / 100;
  return {
    kcal: round1(food.per100g.kcal * scale),
    proteinG: round1(food.per100g.proteinG * scale),
    carbsG: round1(food.per100g.carbsG * scale),
    fatG: round1(food.per100g.fatG * scale),
    fibreG: round1(food.per100g.fibreG * scale),
  };
}

export const ingredientInputSchema = z.strictObject({
  /** An app.foods id (a UUID), or the id of one of the ten starter foods of older plans. */
  foodId: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/),
  /** Grams, up to one decimal. */
  grams: z.number().min(1).max(5000).multipleOf(0.1),
  /** How the coach says it, e.g. "2 pieces" (the grams are what counts). */
  label: z.string().trim().max(40).nullable(),
  proteinSource: z.boolean(),
});

export const optionInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  note: z.string().max(200),
  ingredients: z.array(ingredientInputSchema).max(MAX_INGREDIENTS),
});

export const slotInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(30),
  logsAs: z.enum(MEAL_TYPES),
  options: z.array(optionInputSchema).max(MAX_OPTIONS),
});

export const dietInputSchema = z
  .strictObject({
    calorieTarget: z.number().int().min(500).max(10000).nullable(),
    proteinTarget: z.number().int().min(10).max(500).nullable(),
    note: z.string().max(300),
    slots: z.array(slotInputSchema).min(1).max(MAX_SLOTS),
  })
  ;
export type DietInput = z.output<typeof dietInputSchema>;

// --- What the server stores and returns: the input plus the food's name and the nutrition of this quantity ---

export type DietIngredient = { foodId: string; name: string; grams: number; label: string | null; proteinSource: boolean } & Nutrition;
export type DietOption = { name: string; note: string; ingredients: DietIngredient[] };
export type DietSlot = { name: string; logsAs: MealType; options: DietOption[] };
export type DietContent = { calorieTarget: number | null; proteinTarget: number | null; note: string; slots: DietSlot[] };

const ZERO: Nutrition = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 };
const add = (a: Nutrition, b: Nutrition): Nutrition => ({
  kcal: round1(a.kcal + b.kcal),
  proteinG: round1(a.proteinG + b.proteinG),
  carbsG: round1(a.carbsG + b.carbsG),
  fatG: round1(a.fatG + b.fatG),
  fibreG: round1(a.fibreG + b.fibreG),
});

export const optionTotals = (option: DietOption): Nutrition => option.ingredients.reduce<Nutrition>((total, ingredient) => add(total, ingredient), ZERO);

/** The day's total for one choice of option per slot (default: the first option of each slot). */
export function dayTotals(content: DietContent, picks: readonly number[] = []): Nutrition {
  return content.slots.reduce<Nutrition>((total, slot, index) => {
    const option = slot.options[picks[index] ?? 0];
    return option ? add(total, optionTotals(option)) : total;
  }, ZERO);
}

/** (actual − target) / target, e.g. −0.13 for 13 % under; null with no target. */
export const deviation = (actual: number, target: number | null): number | null => (target ? (actual - target) / target : null);
export const isOffTarget = (value: number | null): boolean => value !== null && Math.abs(value) > OFF_TARGET_WARNING;

/** A plan can go live only when every slot has an option, and every option has ingredients. */
export function dietIsReady(content: DietContent): boolean {
  return (
    content.slots.length > 0 &&
    content.slots.every(
      (slot) =>
        slot.options.length > 0 &&
        slot.options.every((option) => option.ingredients.length > 0),
    )
  );
}

/** The protein source is always stored and shown first. */
export function proteinFirst<T extends { proteinSource: boolean }>(ingredients: readonly T[]): T[] {
  return [...ingredients.filter((ingredient) => ingredient.proteinSource), ...ingredients.filter((ingredient) => !ingredient.proteinSource)];
}

/**
 * Scales every quantity by `factor` (whole grams, 1 to 5000) and scales the stored nutrition with it. Used when a template is given to a client, so the plan fits their calorie target.
 */
export function scaleContent(content: DietContent, factor: number): DietContent {
  return {
    ...content,
    slots: content.slots.map((slot) => ({
      ...slot,
      options: slot.options.map((option) => ({
        ...option,
        ingredients: option.ingredients.map((ingredient) => {
          const grams = Math.min(5000, Math.max(1, Math.round(ingredient.grams * factor)));
          const scale = ingredient.grams > 0 ? grams / ingredient.grams : 1;
          return {
            ...ingredient,
            grams,
            kcal: round1(ingredient.kcal * scale),
            proteinG: round1(ingredient.proteinG * scale),
            carbsG: round1(ingredient.carbsG * scale),
            fatG: round1(ingredient.fatG * scale),
            fibreG: round1(ingredient.fibreG * scale),
          };
        }),
      })),
    })),
  };
}

/** The factor that brings the day total (option 1 of each slot) to the client's calorie target; null when it cannot be worked out. */
export function scaleFactor(content: DietContent, calorieTarget: number | null): number | null {
  const total = dayTotals(content).kcal;
  return calorieTarget && total > 0 ? calorieTarget / total : null;
}

// --- Requests ---

const nameSchema = z.string().trim().min(1).max(80);

export const dietTemplateRequestSchema = z.strictObject({
  name: nameSchema,
  goal: z.enum(DIET_GOALS),
  visibility: z.enum(['gym', 'personal']),
  content: dietInputSchema,
});
export type DietTemplateRequest = z.input<typeof dietTemplateRequestSchema>;
export type DietTemplateInput = z.output<typeof dietTemplateRequestSchema>;

/** POST /v1/diet-plans: draft copies of a template for each chosen client. `scale` fits the quantities to each client's calorie target. */
export const assignDietPlanRequestSchema = z.strictObject({
  templateId: idSchema,
  traineeIds: z.array(idSchema).min(1).max(50),
  startDate: z.iso.date(),
  scale: z.boolean(),
  /** The app always sends true: the new plans go live straight away (an old draft of the client is removed). */
  publish: z.boolean().optional(),
});
export type AssignDietPlanRequest = z.infer<typeof assignDietPlanRequestSchema>;

export const updateDietPlanRequestSchema = z.strictObject({
  name: nameSchema,
  startDate: z.iso.date(),
  content: dietInputSchema,
});
export type UpdateDietPlanRequest = z.input<typeof updateDietPlanRequestSchema>;

// --- Responses ---

export type DietTemplateSummary = {
  id: string;
  name: string;
  goal: (typeof DIET_GOALS)[number];
  visibility: 'gym' | 'personal';
  active: boolean;
  slots: number;
  options: number;
  calorieTarget: number | null;
  canEdit: boolean;
  updatedAt: string;
};
export type DietTemplateDetail = DietTemplateSummary & { content: DietContent };

export type DietPlanSummary = {
  id: string;
  traineeId: string;
  traineeName: string;
  coachId: string;
  coachName: string | null;
  name: string;
  status: PlanStatus;
  startDate: string;
  calorieTarget: number | null;
  liveVersion: number | null;
  version: number;
  updatedAt: string;
};
export type DietPlanDetail = DietPlanSummary & {
  content: DietContent;
  lastChange: PlanChange | null;
  /** The client's own targets, to build the plan against (null when they have none). */
  clientTargets: { calories: number | null; proteinG: number | null };
  /** Whether the plan can be published (not once it has ended). */
  canPublish: boolean;
  /** Whether the client's FitSphere app can show a published plan yet (it waits for TCR-004, C-D22). */
  clientSees: boolean;
};
export type DietPlanListResponse = { plans: DietPlanSummary[]; coaches: { id: string; name: string | null }[] };

// --- A client's logged food, read from the FitSphere app (GET /v1/clients/{id}/nutrition) ---

export type NutritionItem = {
  name: string;
  amount: { value: number; unit: string } | null;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  /** The client estimated the values instead of reading a label. */
  estimated: boolean;
};
export type NutritionMeal = {
  id: string;
  /** breakfast, lunch, dinner, snack ... as the FitSphere app names it. */
  mealType: string;
  recordedAt: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fibreG: number | null;
  items: NutritionItem[];
  /** A public link, or a stored file that this app cannot show yet (it needs a link only the trainee API can issue). */
  photo: { kind: 'link'; url: string } | { kind: 'stored' } | null;
};
export type NutritionTotals = { kcal: number; proteinG: number; carbsG: number; fatG: number; fibreG: number };
export type ClientNutritionResponse = {
  day: string;
  totals: NutritionTotals;
  targets: { kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; fibreG: number | null };
  meals: NutritionMeal[];
  /** The 7 days up to and including `day` that have meals, newest first. */
  week: { day: string; kcal: number | null; meals: number }[];
};
