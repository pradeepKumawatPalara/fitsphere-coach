// Workout management routes (CF06). For a Coach or Head Coach; every handler also checks that the
// template or client is theirs to see (invariant 1: hiding a button is never protection).
//   GET  /v1/exercises                      the exercise library: ?q= ?category= ?muscle= ?equipment= ?group= ?limit= ?offset=
//                                           or ?codes=a,b,c to get the names of a plan's exercises
//   GET  /v1/exercises/filters              categories, muscles, equipment and groups with counts
//   GET  /v1/exercises/{code}               one exercise with steps, watch-for and video
//   GET  /v1/workout-templates              ?q= ?goal= ?difficulty= ?includeInactive=true
//   POST /v1/workout-templates              create (gym-wide or personal)
//   GET  /v1/workout-templates/{id}         one template
//   PUT  /v1/workout-templates/{id}         edit (author; the Head Coach for gym-wide)
//   POST /v1/workout-templates/{id}/copy    a personal copy
//   POST /v1/workout-templates/{id}/deactivate | /activate
//   GET  /v1/training-plans                 ?q= ?status= ?coachId=
//   POST /v1/training-plans                 draft copies of a template for chosen clients
//   GET  /v1/training-plans/{id}            one plan
//   PUT  /v1/training-plans/{id}            edit the working copy
//   GET  /v1/training-plans/{id}/history    change log and published versions
//   POST /v1/training-plans/{id}/publish    off until TCR-003 (answers not found)
//   POST /v1/training-plans/{id}/end | /discard | /restore
import {
  API_BASE_PATH,
  assignPlanRequestSchema,
  DIFFICULTIES,
  EXERCISE_PAGE_SIZE,
  exerciseCodeSchema,
  MAX_EXERCISE_LOOKUP,
  GOALS,
  idSchema,
  PLAN_STATUSES,
  restorePlanRequestSchema,
  templateRequestSchema,
  updatePlanRequestSchema,
  validationDetails,
} from '@fitsphere-coach/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { z } from 'zod';
import { requireAccount } from '../access.ts';
import { ApiError } from '../errors.ts';
import { assertExercisesExist, exerciseDetail, exerciseFilters, lookupExercises, searchExercises } from '../exercises.ts';
import { assignPlans, discardPlan, endPlan, getPlan, listPlans, planHistory, publishPlan, restorePlan, updatePlan } from '../plans.ts';
import { copyTemplate, createTemplate, getTemplate, listTemplates, setTemplateActive, updateTemplate } from '../workouts.ts';

export function registerWorkoutRoutes(app: FastifyInstance, deps: { db: pg.Pool | Pick<pg.Pool, 'query'> }) {
  function pool(): pg.Pool {
    if (!('connect' in deps.db)) throw new Error('Workout management needs a database pool');
    return deps.db;
  }
  /** A malformed id is "not found", the same answer as an id that is not yours. */
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
  /** An optional text query value that must be one of `allowed`, or short free text when `allowed` is null. */
  function option(query: Record<string, unknown>, name: string, allowed: readonly string[] | null): string | undefined {
    const value = query[name];
    if (value === undefined) return undefined;
    const ok = typeof value === 'string' && (allowed ? allowed.includes(value) : value.length <= 100);
    if (!ok) throw new ApiError('VALIDATION_FAILED', [{ field: name, issue: 'invalid_format' }]);
    return value;
  }

  /** A whole-number query value in a range, or undefined. */
  function whole(query: Record<string, unknown>, name: string, min: number, max: number): number | undefined {
    const value = query[name];
    if (value === undefined) return undefined;
    const number = typeof value === 'string' && /^[0-9]{1,6}$/.test(value) ? Number(value) : Number.NaN;
    if (!(number >= min && number <= max)) throw new ApiError('VALIDATION_FAILED', [{ field: name, issue: 'out_of_range' }]);
    return number;
  }

  app.get(`${API_BASE_PATH}/exercises`, { config: { access: 'coach' } }, async (request) => {
    const query = request.query as Record<string, unknown>;
    if (query.codes !== undefined) {
      const codes = typeof query.codes === 'string' ? query.codes.split(',') : [];
      const parsed = codes.map((code) => exerciseCodeSchema.safeParse(code));
      if (codes.length === 0 || codes.length > MAX_EXERCISE_LOOKUP || parsed.some((result) => !result.success)) {
        throw new ApiError('VALIDATION_FAILED', [{ field: 'codes', issue: 'invalid_format' }]);
      }
      return { exercises: await lookupExercises(deps.db, codes) };
    }
    return searchExercises(deps.db, {
      q: option(query, 'q', null),
      category: option(query, 'category', null),
      muscle: option(query, 'muscle', null),
      equipment: option(query, 'equipment', null),
      group: option(query, 'group', null),
      limit: whole(query, 'limit', 1, 100) ?? EXERCISE_PAGE_SIZE,
      offset: whole(query, 'offset', 0, 100000),
    });
  });

  app.get(`${API_BASE_PATH}/exercises/filters`, { config: { access: 'coach' } }, async () => exerciseFilters(deps.db));

  app.get(`${API_BASE_PATH}/exercises/:code`, { config: { access: 'coach' } }, async (request) => {
    const parsed = exerciseCodeSchema.safeParse((request.params as { code?: unknown }).code);
    if (!parsed.success) throw new ApiError('NOT_FOUND');
    return { exercise: await exerciseDetail(deps.db, parsed.data) };
  });

  app.get(`${API_BASE_PATH}/workout-templates`, { config: { access: 'coach' } }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const includeInactive = option(query, 'includeInactive', ['true', 'false']);
    return {
      templates: await listTemplates(deps.db, requireAccount(request), {
        q: option(query, 'q', null),
        goal: option(query, 'goal', GOALS),
        difficulty: option(query, 'difficulty', DIFFICULTIES),
        includeInactive: includeInactive === 'true',
      }),
    };
  });

  app.post(`${API_BASE_PATH}/workout-templates`, { config: { access: 'coach' } }, async (request, reply) => {
    const input = body(request, templateRequestSchema);
    await assertExercisesExist(deps.db, input.content);
    const template = await createTemplate(deps.db, requireAccount(request), input);
    request.log.info({ event: 'template_created', userId: requireAccount(request).id }, 'template created');
    return reply.status(201).send({ template });
  });

  app.get(`${API_BASE_PATH}/workout-templates/:id`, { config: { access: 'coach' } }, async (request) => ({
    template: await getTemplate(deps.db, requireAccount(request), pathId(request.params)),
  }));

  app.put(`${API_BASE_PATH}/workout-templates/:id`, { config: { access: 'coach' } }, async (request) => {
    const input = body(request, templateRequestSchema);
    await assertExercisesExist(deps.db, input.content);
    return { template: await updateTemplate(deps.db, requireAccount(request), pathId(request.params), input) };
  });

  app.post(`${API_BASE_PATH}/workout-templates/:id/copy`, { config: { access: 'coach' } }, async (request, reply) =>
    reply.status(201).send({ template: await copyTemplate(deps.db, requireAccount(request), pathId(request.params)) }),
  );

  app.post(`${API_BASE_PATH}/workout-templates/:id/deactivate`, { config: { access: 'coach' } }, async (request, reply) => {
    await setTemplateActive(deps.db, requireAccount(request), pathId(request.params), false);
    return reply.status(204).send();
  });

  app.post(`${API_BASE_PATH}/workout-templates/:id/activate`, { config: { access: 'coach' } }, async (request, reply) => {
    await setTemplateActive(deps.db, requireAccount(request), pathId(request.params), true);
    return reply.status(204).send();
  });

  app.get(`${API_BASE_PATH}/training-plans`, { config: { access: 'coach' } }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const coachId = query.coachId === undefined ? undefined : idSchema.safeParse(query.coachId);
    if (coachId && !coachId.success) throw new ApiError('VALIDATION_FAILED', [{ field: 'coachId', issue: 'invalid_format' }]);
    return listPlans(deps.db, requireAccount(request), {
      q: option(query, 'q', null),
      status: option(query, 'status', PLAN_STATUSES),
      coachId: coachId?.data,
    });
  });

  app.post(`${API_BASE_PATH}/training-plans`, { config: { access: 'coach' } }, async (request, reply) => {
    const plans = await assignPlans(pool(), requireAccount(request), body(request, assignPlanRequestSchema));
    request.log.info({ event: 'plans_assigned', userId: requireAccount(request).id, count: plans.length }, 'plans assigned');
    return reply.status(201).send({ plans });
  });

  app.get(`${API_BASE_PATH}/training-plans/:id`, { config: { access: 'coach' } }, async (request) => ({
    plan: await getPlan(deps.db, requireAccount(request), pathId(request.params)),
  }));

  app.put(`${API_BASE_PATH}/training-plans/:id`, { config: { access: 'coach' } }, async (request) => {
    const input = body(request, updatePlanRequestSchema);
    await assertExercisesExist(deps.db, input.content);
    return { plan: await updatePlan(pool(), requireAccount(request), pathId(request.params), input) };
  });

  app.get(`${API_BASE_PATH}/training-plans/:id/history`, { config: { access: 'coach' } }, async (request) =>
    planHistory(deps.db, requireAccount(request), pathId(request.params)),
  );

  app.post(`${API_BASE_PATH}/training-plans/:id/publish`, { config: { access: 'coach' } }, async (request, reply) => {
    await publishPlan(pool(), requireAccount(request), pathId(request.params));
    request.log.info({ event: 'plan_published', userId: requireAccount(request).id }, 'plan published');
    return reply.status(204).send();
  });

  app.post(`${API_BASE_PATH}/training-plans/:id/end`, { config: { access: 'coach' } }, async (request, reply) => {
    await endPlan(pool(), requireAccount(request), pathId(request.params));
    return reply.status(204).send();
  });

  app.post(`${API_BASE_PATH}/training-plans/:id/discard`, { config: { access: 'coach' } }, async (request, reply) => {
    await discardPlan(pool(), requireAccount(request), pathId(request.params));
    return reply.status(204).send();
  });

  app.post(`${API_BASE_PATH}/training-plans/:id/restore`, { config: { access: 'coach' } }, async (request) => ({
    plan: await restorePlan(pool(), requireAccount(request), pathId(request.params), body(request, restorePlanRequestSchema).version),
  }));
}
