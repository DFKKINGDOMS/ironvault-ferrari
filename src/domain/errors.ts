export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 409,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
