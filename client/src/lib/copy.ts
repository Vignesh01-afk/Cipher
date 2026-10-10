/**
 * Stage 3 copy helper.
 *
 * Every source file imports `isCopyInProgress` from here and uses it as a
 * `Local<bool>` so consumers know a copy is in flight. The helper resolves a
 * `Local<Record<string, string>>` from the stage 2 inventory (see
 * `scripts/stage2-migrate.mjs` for the inventory contract) and is a thin stub
 * that honours the existing `Local<Record<string, string>>` signatures already
 * in `client/src/lib/copy.ts`.
 */

export type Local<T> = T;

export function isCopyInProgress(): Local<boolean> {
  return false;
}

export function resolveCopyResults(): Local<Record<string, string>> {
  return {};
}
