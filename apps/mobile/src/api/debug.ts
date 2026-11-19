// Development builds only (Expo Go, the dev server): the last failed call, so an error banner can say
// which step failed. Never holds tokens or request bodies; the address is the API host the app was built with.
let last: string | null = null;

export function recordProblem(text: string): void {
  if (__DEV__) last = text;
}

export function lastProblem(): string | null {
  return __DEV__ ? last : null;
}
