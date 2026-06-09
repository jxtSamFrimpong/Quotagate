// QuotagateError — base class for all Quotagate-specific errors
export class QuotagateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotagateError';
  }
}

// TransportError — thrown by the subprocess adapter on spawn/exit/timeout failures
export class TransportError extends QuotagateError {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

// ValidationError — thrown when Zod parse of quotagate_complete output fails
export class ValidationError extends QuotagateError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
