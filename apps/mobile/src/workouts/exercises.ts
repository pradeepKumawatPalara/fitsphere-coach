// Exercise names for plans (CF06). The library has 2,000+ exercises, so the app does not hold the list:
// it remembers the names it has seen (picked in the picker or fetched for a plan) and asks the server for
// the rest in one call.
import type { ExerciseSummary } from '@fitsphere-coach/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { loadExerciseNames } from './service';

const names = new Map<string, string>();

export function rememberExercises(list: ExerciseSummary[]): void {
  for (const exercise of list) names.set(exercise.code, exercise.name);
}

/** The exercise's name if known, otherwise its code. */
export const exerciseName = (code: string): string => names.get(code) ?? code;

/** Fetches the names of `codes` that are not known yet and re-renders when they arrive. */
export function useExerciseNames(codes: string[]): void {
  const { deps } = useAuth();
  const [, setVersion] = useState(0);
  const key = [...new Set(codes)].sort().join(',');
  useEffect(() => {
    const missing = key.split(',').filter((code) => code && !names.has(code));
    if (missing.length === 0) return;
    let current = true;
    void loadExerciseNames(deps, missing.slice(0, 60)).then((result) => {
      if (!current || result.kind !== 'ok') return;
      rememberExercises(result.body.exercises);
      setVersion((version) => version + 1);
    });
    return () => {
      current = false;
    };
  }, [deps, key]);
}

/** Every exercise code in a plan, for `useExerciseNames`. */
export const codesOf = (content: { days: { exercises: { exerciseId: string }[] }[] }): string[] =>
  content.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseId));
