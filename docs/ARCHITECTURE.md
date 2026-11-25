# MikosChat Architecture

MikosChat is a self-hosted real-time messaging platform.

## Components

- NestJS: REST API and application services.
- Socket.IO: real-time communication.
- PostgreSQL: persistent application data.
- Prisma: database access and migrations.
- Redis: online presence management.
- Local storage: avatars and attachments.
- Expo: mobile push notification integration.

## Communication

The web and mobile clients communicate with the server
through REST endpoints and authenticated WebSocket connections.

## Authentication

- JWT access tokens.
- Rotating refresh tokens.
- Server-side session validation.
- Argon2id password hashing.

## Deployment

Docker Compose manages the backend, PostgreSQL and Redis.
The web client is served through Nginx.

Production deployments should use HTTPS and keep database
and Redis services inaccessible from the public internet.

## Current limitations

- End-to-end encryption is not implemented.
- Horizontal scaling has not been fully validated.
- Voice and video calls are not implemented.
- The project is currently in alpha development.
