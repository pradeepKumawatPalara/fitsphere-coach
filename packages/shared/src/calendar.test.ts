import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isoWeekday, moveActivityRequestSchema, scheduleNutritionRequestSchema, scheduleWorkoutRequestSchema, workoutDates } from './calendar.ts';

const ID = '11111111-1111-4111-8111-111111111111';

describe('dates', () => {
  it('adds days across month ends and works out the ISO weekday and the gap', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(isoWeekday('2026-11-09')).toBe(1); // Monday
    expect(isoWeekday('2026-11-15')).toBe(7); // Sunday
    expect(daysBetween('2026-11-09', '2026-11-15')).toBe(6);
  });
});

describe('workout dates', () => {
  const none = { repeat: null, skipDates: [] as string[] };
  it('is one date without a repeat', () => {
    expect(workoutDates({ date: '2026-11-12', dayIndex: 2, ...none }, [0, 2, 3])).toEqual([{ date: '2026-11-12', dayIndex: 2 }]);
  });
  it('gives the training days out in turn, starting with the chosen one, on the chosen weekdays', () => {
    const dates = workoutDates({ date: '2026-11-09', dayIndex: 2, repeat: { weekdays: [1, 3, 5], weeks: 2 }, skipDates: [] }, [0, 2, 3]);
    expect(dates.map((d) => d.date)).toEqual(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-18', '2026-11-20']);
    expect(dates.map((d) => d.dayIndex)).toEqual([2, 3, 0, 2, 3, 0]);
  });
  it('starts a repeat in the middle of a week and leaves out skipped dates', () => {
    const dates = workoutDates({ date: '2026-11-12', dayIndex: 0, repeat: { weekdays: [4], weeks: 3 }, skipDates: ['2026-11-19'] }, [0, 2]);
    expect(dates.map((d) => d.date)).toEqual(['2026-11-12', '2026-11-26']);
  });
  it('is empty with no training days', () => {
    expect(workoutDates({ date: '2026-11-12', dayIndex: 0, ...none }, [])).toEqual([]);
  });
});

describe('requests', () => {
  const workout = { traineeId: ID, planId: ID, dayIndex: 0, date: '2026-11-12', time: '07:00', notes: '', repeat: null, skipDates: [] };
  it('accepts a workout schedule, with and without a time or a repeat', () => {
    expect(scheduleWorkoutRequestSchema.safeParse(workout).success).toBe(true);
    expect(scheduleWorkoutRequestSchema.safeParse({ ...workout, time: null, repeat: { weekdays: [1, 4], weeks: 4 } }).success).toBe(true);
  });
  it.each([
    ['a time of 7am', { time: '7am' }],
    ['25:00', { time: '25:00' }],
    ['13 weeks', { repeat: { weekdays: [1], weeks: 13 } }],
    ['weekday 8', { repeat: { weekdays: [8], weeks: 1 } }],
    ['no weekdays', { repeat: { weekdays: [], weeks: 1 } }],
    ['a bad date', { date: '12/11/2026' }],
    ['an unknown field', { extra: 1 }],
  ])('refuses %s', (_name, over) => {
    expect(scheduleWorkoutRequestSchema.safeParse({ ...workout, ...over }).success).toBe(false);
  });
  it('checks diet and move requests', () => {
    expect(scheduleNutritionRequestSchema.safeParse({ traineeId: ID, planId: ID, from: '2026-11-17', to: '2026-12-14', notes: '' }).success).toBe(true);
    expect(scheduleNutritionRequestSchema.safeParse({ traineeId: ID, planId: ID, from: '2026-11-17', notes: '' }).success).toBe(false);
    expect(moveActivityRequestSchema.safeParse({ date: '2026-11-13', time: null, reason: '  travelling ' }).success).toBe(true);
    expect(moveActivityRequestSchema.safeParse({ date: '2026-11-13', time: null, reason: 'x'.repeat(201) }).success).toBe(false);
  });
});
