import type { TestInfo } from '@playwright/test';

export type KnownBug = {
  id: string;
  title: string;
  status: 'open' | 'fixed';
  expectedBehavior: string;
  currentBehavior: string;
};

export const knownBugs: KnownBug[] = [];

export function markKnownBug(testInfo: TestInfo, id: string) {
  const bug = knownBugs.find((item) => item.id === id);
  if (!bug) throw new Error(`Unknown bug id: ${id}`);
  testInfo.annotations.push({ type: 'known-bug', description: `${bug.id}: ${bug.title}` });
}
