/**
 * The request can never succeed as given (unknown repo or ref, nothing to analyze).
 * Activities throw it and the workflow's retry policy lists it as non-retryable by name.
 */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

/** The deployment is misconfigured (missing or rejected credentials). Also non-retryable. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
