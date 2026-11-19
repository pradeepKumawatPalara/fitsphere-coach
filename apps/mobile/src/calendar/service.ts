// Calendar calls (CF09). The server decides who sees and changes what; the app shows what it answers and
// decides from the error code, never the message.
import type {
  ActivityDetail,
  CalendarOptions,
  CalendarResponse,
  MoveActivityRequest,
  ScheduleNutritionRequest,
  SchedulePreview,
  ScheduleResult,
  ScheduleWorkoutRequest,
} from '@fitsphere-coach/shared';
import type { AuthDeps } from '../auth/service';
import { call, type Result } from '../workouts/service';

const enc = encodeURIComponent;
const unwrap = <T, K extends string>(result: Result<Record<K, T>>, key: K): Result<T> => (result.kind === 'ok' ? { kind: 'ok', body: result.body[key] } : result);

export async function loadCalendar(deps: AuthDeps, range: { from: string; to: string; traineeId?: string; coachId?: string }): Promise<Result<CalendarResponse>> {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (range.traineeId) params.set('traineeId', range.traineeId);
  if (range.coachId) params.set('coachId', range.coachId);
  return call<CalendarResponse>(deps, `/calendar?${params.toString()}`);
}

export const loadOptions = (deps: AuthDeps, traineeId: string): Promise<Result<CalendarOptions>> => call<CalendarOptions>(deps, `/calendar/options?traineeId=${enc(traineeId)}`);

export const previewWorkout = (deps: AuthDeps, request: ScheduleWorkoutRequest): Promise<Result<SchedulePreview>> => call<SchedulePreview>(deps, '/calendar/workouts/preview', 'POST', request);
export const saveWorkout = (deps: AuthDeps, request: ScheduleWorkoutRequest): Promise<Result<ScheduleResult>> => call<ScheduleResult>(deps, '/calendar/workouts', 'POST', request);
export const saveNutrition = (deps: AuthDeps, request: ScheduleNutritionRequest): Promise<Result<ScheduleResult>> => call<ScheduleResult>(deps, '/calendar/nutrition', 'POST', request);

export async function loadActivity(deps: AuthDeps, id: string): Promise<Result<ActivityDetail>> {
  return unwrap(await call<{ activity: ActivityDetail }>(deps, `/calendar/activities/${enc(id)}`), 'activity');
}
export async function moveActivity(deps: AuthDeps, id: string, request: MoveActivityRequest): Promise<Result<ActivityDetail>> {
  return unwrap(await call<{ activity: ActivityDetail }>(deps, `/calendar/activities/${enc(id)}`, 'PUT', request), 'activity');
}
export async function completeActivity(deps: AuthDeps, id: string): Promise<Result<ActivityDetail>> {
  return unwrap(await call<{ activity: ActivityDetail }>(deps, `/calendar/activities/${enc(id)}/complete`, 'POST', {}), 'activity');
}
export async function removeActivity(deps: AuthDeps, id: string): Promise<Result<null>> {
  const result = await call<unknown>(deps, `/calendar/activities/${enc(id)}/remove`, 'POST', {});
  return result.kind === 'ok' ? { kind: 'ok', body: null } : result;
}
