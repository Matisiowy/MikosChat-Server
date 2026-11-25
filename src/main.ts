import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { getCorsOrigins, getTrustProxy } from './config/environment';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('MikosChat');

  const jwtSecret = process.env.JWT_SECRET ?? '';

  if (
    jwtSecret.length < 32 ||
    jwtSecret.startsWith('CHANGE_ME')
  ) {
    await app.close();
    throw new Error(
      'JWT_SECRET must be a unique, randomly generated secret of at least 32 characters.',
    );
  }

  app.set('trust proxy', getTrustProxy());

  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? undefined
          : false,
    }),
  );

  app.use(cookieParser());

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: getCorsOrigins(),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('MikosChat API')
      .setDescription('Official MikosChat API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3000);

  await app.listen(port, '0.0.0.0');

  logger.log(`MikosChat API running on port ${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV}`);
}

void bootstrap();
