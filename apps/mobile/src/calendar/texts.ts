// Texts and small date helpers for the calendar (docs/design/CF09-calendar-ui.md). Days are India days
// written YYYY-MM-DD (invariant 4).
import { addDays, isoWeekday, type ActivityStatus, type CalendarActivity } from '@fitsphere-coach/shared';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((month) => month.slice(0, 3));
const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export { addDays, isoWeekday };

const parts = (day: string) => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) });
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`;
export function monthEnd(day: string): string {
  const { y, m } = parts(day);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export const addMonths = (day: string, months: number): string => {
  const { y, m } = parts(day);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return date.toISOString().slice(0, 10);
};
/** Monday of the week the day is in. */
export const weekStart = (day: string): string => addDays(day, 1 - isoWeekday(day));

/** The 5 or 6 Monday-first weeks that show a month: every day from the Monday before the 1st to the Sunday after the last. */
export function monthGrid(day: string): string[] {
  const first = weekStart(monthStart(day));
  const last = addDays(weekStart(monthEnd(day)), 6);
  const cells: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d);
  return cells;
}

export const monthTitle = (day: string): string => `${MONTHS[parts(day).m - 1]} ${parts(day).y}`;
/** "Wed, 11 Nov" */
export const dayTitle = (day: string): string => `${WEEKDAYS_SHORT[isoWeekday(day) - 1]}, ${parts(day).d} ${MONTHS_SHORT[parts(day).m - 1]}`;
/** "9 – 15 Nov" */
export function weekTitle(day: string): string {
  const a = weekStart(day);
  const b = addDays(a, 6);
  return parts(a).m === parts(b).m ? `${parts(a).d} – ${parts(b).d} ${MONTHS_SHORT[parts(b).m - 1]}` : `${parts(a).d} ${MONTHS_SHORT[parts(a).m - 1]} – ${parts(b).d} ${MONTHS_SHORT[parts(b).m - 1]}`;
}
export const dayNumber = (day: string): number => parts(day).d;
export const weekdayShort = (day: string): string => (WEEKDAYS_SHORT[isoWeekday(day) - 1] ?? '').toUpperCase();

/** "7:00 am" from "07:00". */
export function timeText(time: string | null): string {
  if (!time) return 'All day';
  const hours = Number(time.slice(0, 2));
  return `${hours % 12 || 12}:${time.slice(3, 5)} ${hours >= 12 ? 'pm' : 'am'}`;
}

/** "Thu 12 Nov · 7:00 am", or "17 Nov to 14 Dec" for a diet plan. */
export function whenText(activity: Pick<CalendarActivity, 'kind' | 'startDate' | 'endDate' | 'time'>): string {
  if (activity.kind === 'nutrition') {
    const a = parts(activity.startDate);
    const b = parts(activity.endDate);
    return activity.startDate === activity.endDate ? `${a.d} ${MONTHS_SHORT[a.m - 1]}` : `${a.d} ${MONTHS_SHORT[a.m - 1]} to ${b.d} ${MONTHS_SHORT[b.m - 1]}`;
  }
  return `${dayTitle(activity.startDate).replace(',', '')} · ${timeText(activity.time)}`;
}

export const STATUS_LABELS: Record<ActivityStatus, string> = { assigned: 'Assigned', completed: 'Completed', missed: 'Missed', rescheduled: 'Rescheduled' };

/** Activities on one day (a diet plan shows on every day of its range). */
export const onDay = (activities: readonly CalendarActivity[], day: string): CalendarActivity[] => activities.filter((a) => a.startDate <= day && a.endDate >= day);

export const KIND_LABELS = { workout: 'Workout', nutrition: 'Nutrition' } as const;

export type DayTableRow = {
  traineeId: string;
  name: string;
  workouts: CalendarActivity[];
  diets: CalendarActivity[];
  /** The one status shown for the row: the one that needs attention first. */
  status: ActivityStatus;
};

const ATTENTION: ActivityStatus[] = ['missed', 'assigned', 'rescheduled', 'completed'];

/** One row per client for the day table: their workouts and diet plan, and one status. Rows by name. */
export function dayTableRows(activities: readonly CalendarActivity[]): DayTableRow[] {
  const byClient = new Map<string, DayTableRow>();
  for (const activity of activities) {
    const row = byClient.get(activity.traineeId) ?? { traineeId: activity.traineeId, name: activity.traineeName, workouts: [], diets: [], status: activity.status };
    (activity.kind === 'workout' ? row.workouts : row.diets).push(activity);
    if (ATTENTION.indexOf(activity.status) < ATTENTION.indexOf(row.status)) row.status = activity.status;
    byClient.set(activity.traineeId, row);
  }
  for (const row of byClient.values()) row.workouts.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  return [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const CALENDAR_TEXTS = {
  empty: 'Nothing scheduled',
  noClients: 'You have no clients yet. Add a client first.',
  noWorkoutPlan: 'This client has no active workout plan. Publish one first, then schedule it.',
  noDietPlan: 'This client has no active diet plan. Publish one first, then schedule it.',
  invalid: 'Check the date, the time (like 07:00) and the repeat, then try again.',
  notFound: 'This is no longer available.',
  refused: "You can't do this.",
  completedAuto: 'Completed automatically when the client logs this workout in the FitSphere app that day. A coach can also mark it done.',
  conflictWarning: (dates: string[]) => `${dates.map(dayTitle).join(', ')}: the client already has a workout at the same time. This is a warning, not a block.`,
  conflictRow: 'Already has a workout at this time',
  dietReplaces: 'A diet plan already scheduled on these days is cut short or replaced. This is a warning, not a block.',
  rescheduleBody: 'The client sees the new date next time they open the FitSphere app. The old date stays in the history.',
  addTitle: 'Add to calendar',
  addBody: 'What do you want to schedule?',
  addWorkout: 'Workout',
  addWorkoutSub: "A day of the client's active training plan, once or weekly.",
  addDiet: 'Diet plan',
  addDietSub: "The client's active diet plan over a range of dates.",
  addNeedsActive: 'Needs the client’s plan to be Active. Publish it first from Workouts or Nutrition.',
  tapRow: 'Tap an activity to open it',
  moveWaits: 'Clients see their schedule once the FitSphere app update (TCR-005) is in.',
} as const;
