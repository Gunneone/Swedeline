import { describe, expect, it } from 'vitest';
import { settingsFrom, toPercent } from '../src/shared/settings';

describe('settingsFrom', () => {
  it('defaults to 5 % when nothing is stored', () => {
    expect(settingsFrom({})).toEqual({ enabled: true, percent: 5 });
  });

  it('keeps a stored percent', () => {
    expect(settingsFrom({ enabled: false, percent: 12 })).toEqual({ enabled: false, percent: 12 });
  });

  it('turns an old slider level into its percent, within the new range', () => {
    expect(settingsFrom({ density: 4 }).percent).toBe(4);
    expect(settingsFrom({ density: 7 }).percent).toBe(10);
    expect(settingsFrom({ density: 10 }).percent).toBe(20);
    expect(settingsFrom({ density: 1 }).percent).toBe(2);
  });

  it('prefers the new percent over an old level', () => {
    expect(settingsFrom({ percent: 9, density: 2 }).percent).toBe(9);
  });
});

describe('toPercent', () => {
  it('rounds and clamps to 2..20', () => {
    expect(toPercent(0)).toBe(2);
    expect(toPercent(7.4)).toBe(7);
    expect(toPercent(99)).toBe(20);
    expect(toPercent('8')).toBe(5);
    expect(toPercent(undefined)).toBe(5);
  });
});
