// Workout management (CF06, SPEC-002): the exercise list, workout templates and training plans.
// Request schemas are strict; response types are plain. Weights are whole grams (invariant 5).
import { z } from 'zod';
import { idSchema } from './contracts.ts';

// --- The exercise library (app.exercises, app.exercise_details; read only, owned by the trainee app) ---

/** An exercise code from the shared library, e.g. `barbell-flat-bench-press`. The server checks it exists. */
export const exerciseCodeSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

/** One row of the picker. Details can be missing: 100 library exercises have no `exercise_details` row. */
export type ExerciseSummary = {
  code: string;
  name: string;
  /** app.exercises.exercise_group: barbell, dumbbell, bodyweight, cardio, yoga, ... */
  group: string;
  /** app.exercise_details.category, or null without details. */
  category: string | null;
  primaryMuscle: string | null;
  equipment: string | null;
  /** weight_reps, reps, time, distance_time, ... */
  logType: string;
};
export type ExerciseDetail = ExerciseSummary & {
  subGroup: string | null;
  musclesWorked: string[];
  tags: string[];
  steps: string[];
  watchFor: string | null;
  videoUrl: string | null;
};
export type ExerciseListResponse = { exercises: ExerciseSummary[]; total: number };
export type ExerciseFilterOption = { value: string; count: number };
export type ExerciseFiltersResponse = { categories: ExerciseFilterOption[]; muscles: ExerciseFilterOption[]; equipment: ExerciseFilterOption[]; groups: ExerciseFilterOption[] };

/** GET /v1/clients/{id}/exercises: a client's current plan with each exercise's library details, and what they logged. */
export type ClientPlanExercise = {
  exerciseId: string;
  /** The library name, or the code if the exercise is no longer in the library. */
  name: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  weightG: number | null;
  rpe: number | null;
  restS: number;
  note: string;
  detail: ExerciseDetail | null;
};
export type ClientPlanDay = { name: string; weekday: number | null; rest: boolean; exercises: ClientPlanExercise[] };
export type ClientLoggedWorkout = {
  day: string;
  exercises: { name: string; sets: number | null; reps: number | null; weightG: number | null; note: string | null }[];
};
export type ClientExercisesResponse = {
  plan: { id: string; name: string; status: 'active' | 'draft'; weeks: number | null; days: ClientPlanDay[] } | null;
  /** What the client logged in the FitSphere app (app.workouts), newest day first. Free-text names, not library codes. */
  recent: ClientLoggedWorkout[];
};

export const EXERCISE_PAGE_SIZE = 30;
export const MAX_EXERCISE_LOOKUP = 60;

// --- Plan content (shared by templates and plans) ---

export const GOALS = ['weight_loss', 'muscle_gain', 'strength', 'general_fitness', 'endurance', 'mobility'] as const;
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export const SCHEDULE_MODES = ['weekdays', 'rotating'] as const;
export const TEMPLATE_VISIBILITIES = ['gym', 'personal'] as const;
export const PLAN_STATUSES = ['draft', 'active', 'ended'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const MAX_DAYS = 7;
export const MAX_EXERCISES_PER_DAY = 12;
export const MAX_SETS = 6;

export const planExerciseSchema = z
  .strictObject({
    exerciseId: exerciseCodeSchema,
    /** Exercises with the same number are a superset. */
    group: z.number().int().min(1).max(MAX_EXERCISES_PER_DAY).nullable(),
    sets: z.number().int().min(1).max(MAX_SETS),
    repsMin: z.number().int().min(1).max(100),
    repsMax: z.number().int().min(1).max(100),
    /** Whole grams; null for bodyweight or "pick your own". */
    weightG: z.number().int().min(0).max(1_000_000).nullable(),
    rpe: z.number().int().min(1).max(10).nullable(),
    restS: z.number().int().min(15).max(600),
    note: z.string().max(200),
  })
  .refine((exercise) => exercise.repsMax >= exercise.repsMin, { path: ['repsMax'], message: 'repsMax' });
export type PlanExercise = z.infer<typeof planExerciseSchema>;

export const planDaySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(40),
    /** 1 (Monday) to 7 (Sunday) in weekday mode; null when rotating. */
    weekday: z.number().int().min(1).max(7).nullable(),
    rest: z.boolean(),
    exercises: z.array(planExerciseSchema).max(MAX_EXERCISES_PER_DAY),
  })
  .refine((day) => !day.rest || day.exercises.length === 0, { path: ['exercises'], message: 'rest day' });
export type PlanDay = z.infer<typeof planDaySchema>;

export const planContentSchema = z
  .strictObject({
    /** Null means ongoing. */
    weeks: z.number().int().min(1).max(52).nullable(),
    scheduleMode: z.enum(SCHEDULE_MODES),
    /** Workouts a week, when the coach sets it as the trainee's weekly target; null for no target. */
    weeklyTarget: z.number().int().min(1).max(7).nullable(),
    /** Whether each training day counts as the trainee's daily workout goal. */
    dailyTarget: z.boolean(),
    days: z.array(planDaySchema).min(1).max(MAX_DAYS),
  })
  .superRefine((content, ctx) => {
    const weekdays = content.days.map((day) => day.weekday);
    if (content.scheduleMode === 'rotating' && weekdays.some((weekday) => weekday !== null)) {
      ctx.addIssue({ code: 'custom', path: ['days'], message: 'weekday' });
    }
    if (content.scheduleMode === 'weekdays') {
      if (weekdays.some((weekday) => weekday === null) || new Set(weekdays).size !== weekdays.length) {
        ctx.addIssue({ code: 'custom', path: ['days'], message: 'weekday' });
      }
    }
  });
export type PlanContent = z.infer<typeof planContentSchema>;

/** A plan can go live only with at least one training day, and every training day has an exercise. */
export function planIsReady(content: PlanContent): boolean {
  const training = content.days.filter((day) => !day.rest);
  return training.length > 0 && training.every((day) => day.exercises.length > 0);
}

// --- Templates ---

const nameSchema = z.string().trim().min(1).max(80);

export const templateRequestSchema = z.strictObject({
  name: nameSchema,
  goal: z.enum(GOALS),
  difficulty: z.enum(DIFFICULTIES),
  visibility: z.enum(TEMPLATE_VISIBILITIES),
  content: planContentSchema,
});
export type TemplateRequest = z.input<typeof templateRequestSchema>;
export type TemplateInput = z.output<typeof templateRequestSchema>;

export type TemplateSummary = {
  id: string;
  name: string;
  goal: (typeof GOALS)[number];
  difficulty: (typeof DIFFICULTIES)[number];
  visibility: (typeof TEMPLATE_VISIBILITIES)[number];
  active: boolean;
  days: number;
  exercises: number;
  /** Whether the viewer may edit, copy-and-edit or deactivate it. */
  canEdit: boolean;
  updatedAt: string;
};
export type TemplateDetail = TemplateSummary & { content: PlanContent };

// --- Plans ---

/** POST /v1/training-plans: a draft copy of a template for each chosen client (nothing goes live). */
export const assignPlanRequestSchema = z.strictObject({
  templateId: idSchema,
  traineeIds: z.array(idSchema).min(1).max(50),
  /** The India day the plan starts, today or later; checked by the API. */
  startDate: z.iso.date(),
  /** The app always sends true: the new plans go live straight away (an old draft of the client is removed). */
  publish: z.boolean().optional(),
});
export type AssignPlanRequest = z.infer<typeof assignPlanRequestSchema>;

/** PUT /v1/training-plans/{id}: edit the working copy. On a live plan this makes unpublished changes. */
export const updatePlanRequestSchema = z.strictObject({
  name: nameSchema,
  startDate: z.iso.date(),
  content: planContentSchema,
});
export type UpdatePlanRequest = z.infer<typeof updatePlanRequestSchema>;

export const restorePlanRequestSchema = z.strictObject({ version: z.number().int().min(1) });
export type RestorePlanRequest = z.infer<typeof restorePlanRequestSchema>;

export type PlanSummary = {
  id: string;
  traineeId: string;
  traineeName: string;
  coachId: string;
  coachName: string | null;
  name: string;
  status: PlanStatus;
  startDate: string;
  weeks: number | null;
  /** The version the trainee sees; null for a draft. */
  liveVersion: number | null;
  /** The working copy's version; higher than liveVersion means unpublished changes. */
  version: number;
  updatedAt: string;
};
export type PlanDetail = PlanSummary & {
  content: PlanContent;
  lastChange: PlanChange | null;
  /** Whether the plan can be published (not once it has ended). */
  canPublish: boolean;
  /** Whether the client's FitSphere app can show a published plan yet (it waits for TCR-003, C-D22). */
  clientSees: boolean;
};
export type PlanChange = {
  id: string;
  action: 'created' | 'edited' | 'published' | 'ended' | 'restored' | 'reverted';
  version: number;
  actorId: string;
  actorName: string | null;
  actorRole: 'head_coach' | 'coach';
  summary: string | null;
  at: string;
};
export type PlanListResponse = { plans: PlanSummary[]; coaches: { id: string; name: string | null }[] };
export type PlanHistoryResponse = { changes: PlanChange[]; publishedVersions: number[] };
