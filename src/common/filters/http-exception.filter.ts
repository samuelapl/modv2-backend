import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message = 'Internal server error';
    let errors: any = null;
    let code: string | null = null;
    let params: Record<string, unknown> | null = null;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      message = (exceptionResponse as any).message || message;
      errors = (exceptionResponse as any).errors || null;
      // Set by AppException: lets the client translate the message.
      code = (exceptionResponse as any).code || null;
      params = (exceptionResponse as any).params || null;
    } else if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (
      exception instanceof Error &&
      process.env.NODE_ENV !== 'production'
    ) {
      message = exception.message;
    }

    const internalDetail =
      exception instanceof Error ? exception.message : String(exception);
    this.logger.error(
      `[${request.method}] ${request.url} - Status: ${status} - Error: ${internalDetail}`,
    );

    response.status(status).json({
      success: false,
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
      ...(code ? { code, params: params ?? {} } : {}),
      errors,
    });
  }
}
