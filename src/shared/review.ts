import { ext, isFirefox } from './ext';

/** Word counts at which the popup asks for a store review; after the last, every REVIEW_STEP more. */
export const REVIEW_MILESTONES = [20_000, 50_000, 100_000];
export const REVIEW_STEP = 100_000;

/** The last milestone a word count has reached, 0 before the first. */
export function reviewMilestone(words: number): number {
  const last = REVIEW_MILESTONES[REVIEW_MILESTONES.length - 1];
  if (words >= last) return last + Math.floor((words - last) / REVIEW_STEP) * REVIEW_STEP;
  return REVIEW_MILESTONES.findLast((m) => words >= m) ?? 0;
}

export interface ReviewState {
  /** Highest milestone the user has answered ("not now"): only a later one asks again. */
  answered: number;
  /** Rated, or chose "don't ask again". */
  done: boolean;
}

export const shouldAskForReview = (words: number, state: ReviewState): boolean =>
  !state.done && reviewMilestone(words) > state.answered;

const KEY = 'review';
const area = () => ext.storage.local;

export async function loadReviewState(): Promise<ReviewState> {
  const stored = (await area().get(KEY))[KEY] as Partial<ReviewState> | undefined;
  return { answered: Number(stored?.answered) || 0, done: stored?.done === true };
}

export async function saveReviewState(state: ReviewState): Promise<void> {
  await area().set({ [KEY]: state });
}

/** The reviews page of the store Swedeline was installed from. Both stores find the listing by its ID. */
export function reviewUrl(): string {
  const id = ext.runtime.id;
  if (isFirefox()) {
    const app = navigator.userAgent.includes('Android') ? 'android' : 'firefox';
    return `https://addons.mozilla.org/${app}/addon/${encodeURIComponent(id)}/reviews/`;
  }
  // The name in the path is cosmetic: the store goes by the ID.
  return `https://chromewebstore.google.com/detail/swedeline/${id}/reviews`;
}
