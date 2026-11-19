import { describe, expect, it } from 'vitest';
import { addClientRequestSchema } from './contracts.ts';

describe('addClientRequestSchema (C-D31)', () => {
  it('trims and lower-cases the email and trims the name', () => {
    expect(addClientRequestSchema.parse({ email: '  Priya@Example.TEST ', fullName: '  Priya Nair ' })).toEqual({
      email: 'priya@example.test',
      fullName: 'Priya Nair',
    });
  });
  it('accepts a coach id and refuses a bad one', () => {
    const coachId = '5b6f0c1e-8a6b-4f0e-9c1d-2a3b4c5d6e7f';
    expect(addClientRequestSchema.parse({ email: 'a@b.co', fullName: 'Ab', coachId }).coachId).toBe(coachId);
    expect(addClientRequestSchema.safeParse({ email: 'a@b.co', fullName: 'Ab', coachId: 'x' }).success).toBe(false);
  });
  it('refuses a short name, a bad email and unknown fields', () => {
    expect(addClientRequestSchema.safeParse({ email: 'a@b.co', fullName: 'A' }).success).toBe(false);
    expect(addClientRequestSchema.safeParse({ email: 'nope', fullName: 'Ab' }).success).toBe(false);
    expect(addClientRequestSchema.safeParse({ email: 'a@b.co', fullName: 'Ab', isGymMember: true }).success).toBe(false);
  });
});

describe('updateClientRequestSchema (C-D31)', () => {
  const ok = { fullName: '  Priya Nair ', phone: ' +91 98765 43210 ', fitnessGoal: 'weight_loss', notes: '  Knee  ' };
  it('trims, and turns blank notes into null', async () => {
    const { updateClientRequestSchema } = await import('./contracts.ts');
    expect(updateClientRequestSchema.parse(ok)).toEqual({ fullName: 'Priya Nair', phone: '+91 98765 43210', fitnessGoal: 'weight_loss', notes: 'Knee' });
    expect(updateClientRequestSchema.parse({ ...ok, phone: null, fitnessGoal: null, notes: '   ' })).toMatchObject({ phone: null, fitnessGoal: null, notes: null });
  });
  it('refuses a short name, a bad phone, a bad goal, long notes and the email field', async () => {
    const { updateClientRequestSchema } = await import('./contracts.ts');
    for (const bad of [{ fullName: 'P' }, { phone: 'abc' }, { fitnessGoal: 'flying' }, { notes: 'x'.repeat(501) }, { email: 'a@b.co' }]) {
      expect(updateClientRequestSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
    }
  });
});
