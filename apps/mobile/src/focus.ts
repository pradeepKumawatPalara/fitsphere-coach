// A screen under another screen stays mounted, so what it loaded once goes stale when the coach changes
// something on the next screen and comes back. `useFocusTick` gives a number that goes up each time the
// screen is shown again (not the first time, when it loads anyway). Put it in the dependency list of the
// effect that loads the screen's data and the data is fetched again on return.
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

export function useFocusTick(): number {
  const [tick, setTick] = useState(0);
  const shownBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (shownBefore.current) setTick((value) => value + 1);
      else shownBefore.current = true;
    }, []),
  );
  return tick;
}
