// useFocusTick: goes up each time a screen is shown again, not the first time.
import { act, renderHook } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';
import { useFocusTick } from './focus';

const mockFocusListeners = new Set<() => void>();
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    mockUseEffect(() => {
      callback();
      mockFocusListeners.add(callback);
      return () => void mockFocusListeners.delete(callback);
    }, [callback]);
  },
}));

describe('useFocusTick', () => {
  it('stays at 0 on the first focus and goes up every time the screen is shown again', async () => {
    const { result } = await renderHook(() => useFocusTick());
    expect(result.current).toBe(0);
    await act(async () => mockFocusListeners.forEach((listener) => listener()));
    expect(result.current).toBe(1);
    await act(async () => mockFocusListeners.forEach((listener) => listener()));
    expect(result.current).toBe(2);
  });
});
