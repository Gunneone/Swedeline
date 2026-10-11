import { describe, expect, it } from 'vitest';
import { reviewMilestone, shouldAskForReview } from '../src/shared/review';

describe('reviewMilestone', () => {
  it('is reached at 20k, 50k, 100k and every 100k after that', () => {
    expect(reviewMilestone(0)).toBe(0);
    expect(reviewMilestone(19_999)).toBe(0);
    expect(reviewMilestone(20_000)).toBe(20_000);
    expect(reviewMilestone(49_999)).toBe(20_000);
    expect(reviewMilestone(50_000)).toBe(50_000);
    expect(reviewMilestone(100_000)).toBe(100_000);
    expect(reviewMilestone(199_999)).toBe(100_000);
    expect(reviewMilestone(200_000)).toBe(200_000);
    expect(reviewMilestone(1_234_567)).toBe(1_200_000);
  });
});

describe('shouldAskForReview', () => {
  const fresh = { answered: 0, done: false };

  it('asks once a milestone is reached', () => {
    expect(shouldAskForReview(19_999, fresh)).toBe(false);
    expect(shouldAskForReview(20_000, fresh)).toBe(true);
  });

  it('after "not now", asks again only at the next milestone', () => {
    const later = { answered: 20_000, done: false };
    expect(shouldAskForReview(49_999, later)).toBe(false);
    expect(shouldAskForReview(50_000, later)).toBe(true);
  });

  it('asks once, not once per missed milestone', () => {
    // Several milestones passed since the last answer: one request, for the latest.
    expect(shouldAskForReview(250_000, { answered: 20_000, done: false })).toBe(true);
    expect(shouldAskForReview(250_000, { answered: 200_000, done: false })).toBe(false);
  });

  it("never asks again after rating or \"don't ask again\"", () => {
    expect(shouldAskForReview(5_000_000, { answered: 20_000, done: true })).toBe(false);
  });
});
