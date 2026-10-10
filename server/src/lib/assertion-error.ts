//
// AssertionError is used by the test runner's expect-style assertions.
// This is a minimal re-export of the saved polyfill shape so the build can
// resolve the symbol without bringing in extra dependencies.
//
export class AssertionError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/** Ensure a thrown value is an instance of our app error hierarchy. */
export function ensureAppError(value: unknown): asserts value is Error {
  if (!(value instanceof Error)) {
    throw new AssertionError(`expected an Error, got ${value}`);
  }
}
