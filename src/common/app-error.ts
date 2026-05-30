/**
 * AppError — controllers throw this instead of calling res.error(...).
 * HttpExceptionFilter renders it as { error: { code, message } } with httpStatus.
 * This preserves the exact error envelope + status codes of the Express app
 * (lib/responseHelper.ts res.error) without coupling controllers to res.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}
