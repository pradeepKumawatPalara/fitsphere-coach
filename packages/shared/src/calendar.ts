// Calendar (CF09, SPEC-004): scheduling a client's active workout or diet plan on dates.
// Days are India days written YYYY-MM-DD (invariant 4). "Completed" and "Missed" are worked out by the
// server when it reads; only a coach's "mark as done" is stored.
import { z } from 'zod';
import { idSchema } from './contracts.ts';

export const ACTIVITY_KINDS = ['workout', 'nutrition'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_STATUSES = ['assigned', 'completed', 'missed', 'rescheduled'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const MAX_REPEAT_WEEKS = 12;
export const MAX_NUTRITION_DAYS = 90;
/** The longest span one calendar request may ask for. */
export const MAX_CALENDAR_SPAN_DAYS = 92;

const dateSchema = z.iso.date();
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const repeatSchema = z.strictObject({
  /** 1 (Monday) to 7 (Sunday). */
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  weeks: z.number().int().min(1).max(MAX_REPEAT_WEEKS),
});

export const scheduleWorkoutRequestSchema = z.strictObject({
  traineeId: idSchema,
  /** The client's active training plan. */
  planId: idSchema,
  /** The plan day to start with; a repeat goes on through the plan's training days in turn. */
  dayIndex: z.number().int().min(0).max(6),
  date: dateSchema,
  time: timeSchema.nullable(),
  notes: z.string().max(300),
  repeat: repeatSchema.nullable(),
  /** Dates the coach took out of the reviewed list. */
  skipDates: z.array(dateSchema).max(100),
});
export type ScheduleWorkoutRequest = z.input<typeof scheduleWorkoutRequestSchema>;

export const scheduleNutritionRequestSchema = z.strictObject({
  traineeId: idSchema,
  /** The client's active diet plan. */
  planId: idSchema,
  from: dateSchema,
  to: dateSchema,
  notes: z.string().max(300),
});
export type ScheduleNutritionRequest = z.input<typeof scheduleNutritionRequestSchema>;

export const moveActivityRequestSchema = z.strictObject({
  date: dateSchema,
  time: timeSchema.nullable(),
  reason: z.string().trim().max(200),
});
export type MoveActivityRequest = z.input<typeof moveActivityRequestSchema>;

// --- Dates (pure, on YYYY-MM-DD strings) ---

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** 1 (Monday) to 7 (Sunday). */
export function isoWeekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
}
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export type PlannedDate = { date: string; dayIndex: number };

/**
 * The dates of a workout schedule: one date, or (with a repeat) every date from the start for `weeks`
 * weeks whose weekday is chosen. The plan's training days are given out in turn, starting with the
 * chosen day. `skipDates` are taken out.
 */
export function workoutDates(
  request: { date: string; dayIndex: number; repeat: { weekdays: readonly number[]; weeks: number } | null; skipDates: readonly string[] },
  trainingDays: readonly number[],
): PlannedDate[] {
  if (trainingDays.length === 0) return [];
  const all = request.repeat
    ? Array.from({ length: request.repeat.weeks * 7 }, (_, i) => addDays(request.date, i)).filter((day) => request.repeat?.weekdays.includes(isoWeekday(day)))
    : [request.date];
  const start = Math.max(0, trainingDays.indexOf(request.dayIndex));
  return all.map((date, i) => ({ date, dayIndex: trainingDays[(start + i) % trainingDays.length] as number })).filter((planned) => !request.skipDates.includes(planned.date));
}

// --- Responses ---

export type CalendarActivity = {
  id: string;
  kind: ActivityKind;
  traineeId: string;
  traineeName: string;
  coachId: string;
  coachName: string | null;
  /** The plan day's name, or the diet plan's name. */
  title: string;
  planName: string;
  startDate: string;
  endDate: string;
  /** "07:00" or null. */
  time: string | null;
  notes: string;
  status: ActivityStatus;
};
export type ActivityHistoryItem = {
  action: 'scheduled' | 'moved' | 'completed' | 'removed';
  fromDate: string | null;
  toDate: string | null;
  reason: string | null;
  actorName: string | null;
  actorRole: 'head_coach' | 'coach';
  at: string;
};
export type ActivityDetail = CalendarActivity & { history: ActivityHistoryItem[] };
export type CalendarResponse = { activities: CalendarActivity[]; coaches: { id: string; name: string | null }[] };
export type SchedulePreview = { dates: { date: string; dayIndex: number; dayName: string; conflict: boolean }[] };
export type ScheduleResult = { count: number; conflicts: string[] };
export type CalendarOptions = {
  workoutPlan: { id: string; name: string; days: { index: number; name: string }[] } | null;
  dietPlan: { id: string; name: string } | null;
};
