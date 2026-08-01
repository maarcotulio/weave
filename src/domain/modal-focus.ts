export interface ModalFocusContext {
  currentIndex: number;
  controlCount: number;
  shiftKey: boolean;
}

/**
 * Returns the destination for a Tab key at a modal boundary. Returning
 * undefined leaves ordinary focus movement alone; an index outside the
 * modal is redirected to its nearest boundary so focus cannot escape.
 */
export function trappedFocusIndex({ currentIndex, controlCount, shiftKey }: ModalFocusContext): number | undefined {
  if (controlCount <= 0) return undefined;
  if (currentIndex < 0) return shiftKey ? controlCount - 1 : 0;
  if (shiftKey && currentIndex === 0) return controlCount - 1;
  if (!shiftKey && currentIndex === controlCount - 1) return 0;
  return undefined;
}

/** Selects the preferred enabled control, falling back to the first enabled one. */
export function firstEnabledFocusIndex(enabled: readonly boolean[], preferredIndex = 0): number | undefined {
  if (enabled[preferredIndex]) return preferredIndex;
  const first = enabled.findIndex(Boolean);
  return first >= 0 ? first : undefined;
}

export function canDismissWithEscape(key: string, busy: boolean): boolean {
  return key === 'Escape' && !busy;
}
