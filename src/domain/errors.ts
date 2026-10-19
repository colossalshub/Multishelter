export class AppError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    extras?: { fields?: Record<string, string>; details?: unknown },
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fields = extras?.fields;
    this.details = extras?.details;
  }
}

export function notFound(message = "Not found"): AppError {
  return new AppError(404, "not_found", message);
}

export function validationError(fields: Record<string, string>, message = "Check the highlighted fields."): AppError {
  return new AppError(400, "validation_error", message, { fields });
}
