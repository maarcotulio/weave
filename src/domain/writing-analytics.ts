import { localCalendarDate } from './goals';
import type { WritingActivity } from './types';

export interface WritingAnalytics {
  sessions: number;
  currentStreak: number;
  longestStreak: number;
  averageWordsPerDay: number;
}

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function dateNumber(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * Collapse activity to one net value per local date before calculating metrics.
 * Existing repositories store a cumulative daily delta, but taking the largest
 * value makes reads safe for old/imported records that contain duplicate
 * autosave entries for the same date.
 */
export function normalizeWritingActivity(activity: readonly WritingActivity[]): WritingActivity[] {
  const byDate = new Map<string, number>();
  for (const entry of activity) {
    if (!validDateKey(entry.date)) continue;
    const words = Number.isFinite(entry.words) ? Math.max(0, Math.trunc(entry.words)) : 0;
    byDate.set(entry.date, Math.max(byDate.get(entry.date) ?? 0, words));
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, words]) => ({ date, words }));
}

/** Calculate local, deterministic writing metrics from daily net activity. */
export function calculateWritingAnalytics(activity: readonly WritingActivity[], today = localCalendarDate()): WritingAnalytics {
  const activeDates = normalizeWritingActivity(activity).filter((entry) => entry.words > 0).map((entry) => entry.date);
  if (activeDates.length === 0) return { sessions: 0, currentStreak: 0, longestStreak: 0, averageWordsPerDay: 0 };

  let longestStreak = 1;
  let run = 1;
  for (let index = 1; index < activeDates.length; index += 1) {
    if (dateNumber(activeDates[index]) - dateNumber(activeDates[index - 1]) === 1) run += 1;
    else run = 1;
    longestStreak = Math.max(longestStreak, run);
  }

  let currentStreak = 0;
  const todayNumber = dateNumber(today);
  const lastNumber = dateNumber(activeDates[activeDates.length - 1]);
  if (lastNumber === todayNumber) {
    currentStreak = 1;
    for (let index = activeDates.length - 1; index > 0; index -= 1) {
      if (dateNumber(activeDates[index]) - dateNumber(activeDates[index - 1]) !== 1) break;
      currentStreak += 1;
    }
  }

  const totalWords = normalizeWritingActivity(activity).reduce((total, entry) => total + entry.words, 0);
  return {
    sessions: activeDates.length,
    currentStreak,
    longestStreak,
    averageWordsPerDay: Math.round(totalWords / activeDates.length)
  };
}
