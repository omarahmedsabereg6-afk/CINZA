/**
 * zod validation middleware.
 *
 * Every mutating endpoint declares a schema. Unknown keys are stripped (not merged)
 * so a client cannot smuggle extra fields into a database write.
 */
import HttpError, { ErrorCode } from '../utils/httpError.js';

function formatIssues(issues) {
  return issues.slice(0, 8).map((issue) => ({
    field: issue.path.join('.') || '(body)',
    problem: issue.message,
  }));
}

export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return next(
        HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'Request body failed validation.', formatIssues(result.error.issues))
      );
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) {
      return next(
        HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'Query string failed validation.', formatIssues(result.error.issues))
      );
    }
    // Express 5 makes req.query a getter; assign defensively.
    Object.defineProperty(req, 'validatedQuery', { value: result.data, configurable: true });
    Object.assign(req.query, result.data);
    next();
  };
}

/** Validates the `meta` JSON field that accompanies multipart uploads. */
export function validateUploadMeta(schema) {
  return (req, _res, next) => {
    const raw = req.body?.meta ?? '{}';
    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return next(HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'The `meta` field must be valid JSON.'));
    }
    const result = schema.safeParse(parsed ?? {});
    if (!result.success) {
      return next(
        HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'Upload metadata failed validation.', formatIssues(result.error.issues))
      );
    }
    req.clientMeta = result.data;
    next();
  };
}

export default { validateBody, validateQuery, validateUploadMeta };
