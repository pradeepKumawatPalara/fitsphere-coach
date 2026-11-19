// Calendar routes (CF09). For a Coach or Head Coach; every handler also checks that the client is theirs
// to see (invariant 1).
//   GET  /v1/calendar?from=&to=&traineeId=&coachId=   activities in a span of days (92 at most)
//   GET  /v1/calendar/options?traineeId=              the client's active workout and diet plans
//   POST /v1/calendar/workouts/preview                the dates a workout schedule would make, with conflicts
//   POST /v1/calendar/workouts                        save a workout schedule (once, or repeating)
//   POST /v1/calendar/nutrition                       save a diet plan over a range of days
//   GET/PUT /v1/calendar/activities/{id}              one activity with its history / move it
//   POST /v1/calendar/activities/{id}/complete | /remove
import {
  API_BASE_PATH,
  idSchema,
  moveActivityRequestSchema,
  scheduleNutritionRequestSchema,
  scheduleWorkoutRequestSchema,
  validationDetails,
} from '@fitsphere-coach/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { requireAccount } from '../access.ts';
import { calendarOptions, completeActivity, getActivity, listCalendar, moveActivity, previewWorkout, removeActivity, scheduleNutrition, scheduleWorkout } from '../calendar.ts';
import { ApiError } from '../errors.ts';

export function registerCalendarRoutes(app: FastifyInstance, deps: { db: pg.Pool | Pick<pg.Pool, 'query'> }) {
  function pool(): pg.Pool {
    if (!('connect' in deps.db)) throw new Error('The calendar needs a database pool');
    return deps.db;
  }
  function pathId(params: unknown): string {
    const parsed = idSchema.safeParse((params as { id?: unknown }).id);
    if (!parsed.success) throw new ApiError('NOT_FOUND');
    return parsed.data;
  }
  function body<S extends z.ZodType>(request: FastifyRequest, schema: S): z.output<S> {
    const input: unknown = request.body;
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', validationDetails(parsed.error, input));
    return parsed.data;
  }
  const route = { config: { access: 'coach' as const } };

  const listQuery = z.strictObject({ from: z.iso.date(), to: z.iso.date(), traineeId: idSchema.optional(), coachId: idSchema.optional() });
  app.get(`${API_BASE_PATH}/calendar`, route, async (request) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', validationDetails(parsed.error, request.query));
    return listCalendar(deps.db, requireAccount(request), parsed.data);
  });

  app.get(`${API_BASE_PATH}/calendar/options`, route, async (request) => {
    const parsed = z.strictObject({ traineeId: idSchema }).safeParse(request.query);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', validationDetails(parsed.error, request.query));
    return calendarOptions(deps.db, requireAccount(request), parsed.data.traineeId);
  });

  app.post(`${API_BASE_PATH}/calendar/workouts/preview`, route, async (request) => previewWorkout(deps.db, requireAccount(request), body(request, scheduleWorkoutRequestSchema)));

  app.post(`${API_BASE_PATH}/calendar/workouts`, route, async (request, reply) => {
    const result = await scheduleWorkout(pool(), requireAccount(request), body(request, scheduleWorkoutRequestSchema));
    request.log.info({ event: 'workouts_scheduled', userId: requireAccount(request).id, count: result.count }, 'workouts scheduled');
    return reply.status(201).send(result);
  });

  app.post(`${API_BASE_PATH}/calendar/nutrition`, route, async (request, reply) => {
    const result = await scheduleNutrition(pool(), requireAccount(request), body(request, scheduleNutritionRequestSchema));
    request.log.info({ event: 'diet_scheduled', userId: requireAccount(request).id }, 'diet scheduled');
    return reply.status(201).send(result);
  });

  app.get(`${API_BASE_PATH}/calendar/activities/:id`, route, async (request) => ({ activity: await getActivity(deps.db, requireAccount(request), pathId(request.params)) }));
  app.put(`${API_BASE_PATH}/calendar/activities/:id`, route, async (request) => ({
    activity: await moveActivity(pool(), requireAccount(request), pathId(request.params), body(request, moveActivityRequestSchema)),
  }));
  app.post(`${API_BASE_PATH}/calendar/activities/:id/complete`, route, async (request) => ({ activity: await completeActivity(pool(), requireAccount(request), pathId(request.params)) }));
  app.post(`${API_BASE_PATH}/calendar/activities/:id/remove`, route, async (request, reply) => {
    await removeActivity(pool(), requireAccount(request), pathId(request.params));
    return reply.status(204).send();
  });
}
