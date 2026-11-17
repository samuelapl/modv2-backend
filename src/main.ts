import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Hardening: Hide framework header & enforce OWASP HTTP security headers
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('X-XSS-Protection', '0');
    next();
  });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // CORS (configurable via CORS_ORIGINS comma-separated env var)
  const configuredOrigins = process.env.CORS_ORIGINS
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin:
      configuredOrigins && configuredOrigins.length > 0
        ? configuredOrigins
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global filters & interceptors
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Ethiopian MoD - IDLMS API')
    .setDescription(
      'Integrated Driving Licence Management System API for the Ethiopian Ministry of Defence',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter your MoD JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'MoD IDLMS API Documentation',
  });

  app.enableShutdownHooks();

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Ethiopian MoD IDLMS API is running on: http://localhost:${port}/api/v1`);
  logger.log(`Swagger OpenAPI Documentation: http://localhost:${port}/api/docs`);
}

bootstrap();
