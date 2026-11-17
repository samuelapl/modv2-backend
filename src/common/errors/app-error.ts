import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ErrorCode } from './error-codes';

/** Values that can be sent as message placeholders. Dates: pass an ISO string. */
export type ErrorParams = Record<string, string | number | boolean | null | undefined>;

/** Body of an error response built by the exceptions below. */
export interface AppErrorBody {
  code: ErrorCode;
  params: ErrorParams;
  message: string;
}

function body(code: ErrorCode, params: ErrorParams, message: string): AppErrorBody {
  return { code, params, message };
}

/**
 * Typed API errors: `code` + `params` let the frontend show the message in the
 * user's language; `message` stays English for logs, the audit trail and as a
 * fallback. They extend the standard Nest exceptions, so status codes and
 * `instanceof` checks behave exactly as before.
 *
 *   throw new AppBadRequestException(
 *     'PERMIT_EXPIRED_RENEW_FIRST',
 *     { permit: p.credentialNumber, date: p.expiryDate.toISOString() },
 *     `Permit ${p.credentialNumber} expired on ...`,
 *   );
 */
export class AppBadRequestException extends BadRequestException {
  constructor(code: ErrorCode, params: ErrorParams, message: string) {
    super(body(code, params, message));
  }
}
export class AppNotFoundException extends NotFoundException {
  constructor(code: ErrorCode, params: ErrorParams, message: string) {
    super(body(code, params, message));
  }
}
export class AppForbiddenException extends ForbiddenException {
  constructor(code: ErrorCode, params: ErrorParams, message: string) {
    super(body(code, params, message));
  }
}
export class AppConflictException extends ConflictException {
  constructor(code: ErrorCode, params: ErrorParams, message: string) {
    super(body(code, params, message));
  }
}
export class AppUnauthorizedException extends UnauthorizedException {
  constructor(code: ErrorCode, params: ErrorParams, message: string) {
    super(body(code, params, message));
  }
}
export class AppUnprocessableException extends UnprocessableEntityException {
  constructor(code: ErrorCode, params: ErrorParams, message: string) {
    super(body(code, params, message));
  }
}
