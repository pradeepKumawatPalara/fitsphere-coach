// Client management routes (CF04). For a Coach or Head Coach; every handler also checks that the
// client is theirs to see (invariant 1: hiding a button is never protection).
//   GET  /v1/clients               the clients the caller may see (?q= search, ?coachId= filter)
//   GET  /v1/clients/{id}          one client's profile
//   PUT  /v1/clients/{id}          edit the details the gym keeps (name, phone, goal, notes)
//   GET  /v1/clients/{id}/nutrition  what the client logged in the FitSphere app (?day=YYYY-MM-DD, default today)
//   GET  /v1/clients/{id}/exercises  the client's plan with exercise details, and what they logged
//   POST /v1/clients/{id}/move     Head Coach: move to a Coach of the gym or to themselves
//   POST /v1/clients/{id}/remove   end the link (Head Coach, or the client's own Coach)
//   GET  /v1/clients/available     FitSphere users open to joining a gym (TCR-007; empty until it exists)
//   POST /v1/clients               Head Coach / Gym Owner: add a client directly (C-D31, proposed)
//   POST /v1/clients/invitations            invite a trainee by email (off until TCR-001, C-D22)
//   POST /v1/clients/invitations/{id}/cancel  cancel a pending invitation
import { addClientRequestSchema, API_BASE_PATH, idSchema, inviteClientRequestSchema, moveClientRequestSchema, updateClientRequestSchema, validationDetails } from '@fitsphere-coach/shared';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAccount } from '../access.ts';
import { addClient, findOpenToGym } from '../addClient.ts';
import { clientNutrition } from '../clientNutrition.ts';
import { gymOf } from '../invitations.ts';
import { clientAddedEmail } from '../mailer.ts';
import { clientExercises, clientProfile, listClients, moveClient, removeClient, updateClient } from '../clients.ts';
import { ApiError } from '../errors.ts';
import { cancelInvitation, inviteClient } from '../invitations.ts';
import type { OnboardingDeps } from '../onboarding.ts';

export function registerClientRoutes(app: FastifyInstance, deps: { db: pg.Pool | Pick<pg.Pool, 'query'>; onboarding: OnboardingDeps }) {
  function pool(): pg.Pool {
    if (!('connect' in deps.db)) throw new Error('Client management needs a database pool');
    return deps.db;
  }
  /** A malformed id is "not found", the same answer as an id that is not yours. */
  function traineeId(params: unknown): string {
    const parsed = idSchema.safeParse((params as { id?: unknown }).id);
    if (!parsed.success) throw new ApiError('NOT_FOUND');
    return parsed.data;
  }

  app.get(`${API_BASE_PATH}/clients`, { config: { access: 'coach' } }, async (request) => {
    const query = request.query as { q?: unknown; coachId?: unknown };
    const coachId = query.coachId === undefined ? undefined : idSchema.safeParse(query.coachId);
    if (coachId && !coachId.success) throw new ApiError('VALIDATION_FAILED', [{ field: 'coachId', issue: 'invalid_format' }]);
    if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 100)) {
      throw new ApiError('VALIDATION_FAILED', [{ field: 'q', issue: 'invalid_format' }]);
    }
    return listClients(deps.db, requireAccount(request), { q: query.q as string | undefined, coachId: coachId?.data }, deps.onboarding);
  });

  app.get(`${API_BASE_PATH}/clients/available`, { config: { access: 'coach' } }, async (request) => {
    const query = request.query as { q?: unknown };
    if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 100)) {
      throw new ApiError('VALIDATION_FAILED', [{ field: 'q', issue: 'invalid_format' }]);
    }
    return findOpenToGym(deps.db, requireAccount(request), query.q as string | undefined);
  });

  app.get(`${API_BASE_PATH}/clients/:id`, { config: { access: 'coach' } }, async (request) =>
    clientProfile(deps.db, requireAccount(request), traineeId(request.params)),
  );

  app.get(`${API_BASE_PATH}/clients/:id/nutrition`, { config: { access: 'coach' } }, async (request) => {
    const day = (request.query as { day?: unknown }).day;
    if (day !== undefined && (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)))) {
      throw new ApiError('VALIDATION_FAILED', [{ field: 'day', issue: 'invalid_format' }]);
    }
    return clientNutrition(deps.db, requireAccount(request), traineeId(request.params), day as string | undefined);
  });

  app.get(`${API_BASE_PATH}/clients/:id/exercises`, { config: { access: 'coach' } }, async (request) =>
    clientExercises(deps.db, requireAccount(request), traineeId(request.params)),
  );

  app.put(`${API_BASE_PATH}/clients/:id`, { config: { access: 'coach' } }, async (request, reply) => {
    const body: unknown = request.body;
    const parsed = updateClientRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', validationDetails(parsed.error, body));
    await updateClient(deps.db, requireAccount(request), traineeId(request.params), parsed.data);
    request.log.info({ event: 'client_updated', userId: requireAccount(request).id }, 'client updated');
    return reply.status(204).send();
  });

  app.post(`${API_BASE_PATH}/clients`, { config: { access: 'coach' } }, async (request, reply) => {
    const body: unknown = request.body;
    const parsed = addClientRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', validationDetails(parsed.error, body));
    const viewer = requireAccount(request);
    const client = await addClient(pool(), viewer, parsed.data, deps.onboarding);
    request.log.info({ event: 'client_added', userId: viewer.id }, 'client added');
    // Tell the client by email. The add already succeeded, so a failed email never undoes it: the answer says
    // `emailed: false` and the app tells the owner to let them know. Never log the address or the error text.
    let emailed = true;
    try {
      const gym = await gymOf(pool(), viewer);
      await deps.onboarding.mailer.send(
        clientAddedEmail(deps.onboarding.settings, {
          clientEmail: parsed.data.email,
          clientName: parsed.data.fullName,
          gymName: gym?.gymName ?? 'Your gym',
          waiting: client.waiting === true,
        }),
      );
    } catch {
      emailed = false;
      request.log.warn({ event: 'client_added_email_not_sent', userId: viewer.id }, 'client added email not sent');
    }
    return reply.status(201).send({ client, emailed });
  });

  app.post(`${API_BASE_PATH}/clients/invitations`, { config: { access: 'coach' } }, async (request, reply) => {
    const body: unknown = request.body;
    const parsed = inviteClientRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', validationDetails(parsed.error, body));
    const invitation = await inviteClient(pool(), requireAccount(request), parsed.data, deps.onboarding, request.log);
    request.log.info({ event: 'client_invited', userId: requireAccount(request).id }, 'client invited');
    return reply.status(201).send({ invitation });
  });

  app.post(`${API_BASE_PATH}/clients/invitations/:id/cancel`, { config: { access: 'coach' } }, async (request, reply) => {
    await cancelInvitation(deps.db, requireAccount(request), traineeId(request.params), deps.onboarding);
    request.log.info({ event: 'invitation_cancelled', userId: requireAccount(request).id }, 'invitation cancelled');
    return reply.status(204).send();
  });

  app.post(`${API_BASE_PATH}/clients/:id/move`, { config: { access: 'coach' } }, async (request, reply) => {
    const body: unknown = request.body;
    const parsed = moveClientRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', validationDetails(parsed.error, body));
    await moveClient(pool(), requireAccount(request), traineeId(request.params), parsed.data.coachId);
    request.log.info({ event: 'client_moved', userId: requireAccount(request).id }, 'client moved');
    return reply.status(204).send();
  });

  app.post(`${API_BASE_PATH}/clients/:id/remove`, { config: { access: 'coach' } }, async (request, reply) => {
    await removeClient(pool(), requireAccount(request), traineeId(request.params));
    request.log.info({ event: 'client_removed', userId: requireAccount(request).id }, 'client removed');
    return reply.status(204).send();
  });
}
