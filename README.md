# MikosChat Server

[![CI](https://github.com/Matisiowy/MikosChat-Server/actions/workflows/ci.yml/badge.svg)](https://github.com/Matisiowy/MikosChat-Server/actions)
[![Release](https://img.shields.io/github/v/release/Matisiowy/MikosChat-Server?include_prereleases)](https://github.com/Matisiowy/MikosChat-Server/releases)
[![License](https://img.shields.io/github/license/Matisiowy/MikosChat-Server)](https://github.com/Matisiowy/MikosChat-Server/blob/main/LICENSE)
[![Stars](https://img.shields.io/github/stars/Matisiowy/MikosChat-Server)](https://github.com/Matisiowy/MikosChat-Server/stargazers)
[![Issues](https://img.shields.io/github/issues/Matisiowy/MikosChat-Server)](https://github.com/Matisiowy/MikosChat-Server/issues)
[![Docker Integration](https://github.com/Matisiowy/MikosChat-Server/actions/workflows/integration.yml/badge.svg)](https://github.com/Matisiowy/MikosChat-Server/actions)


![Version](https://img.shields.io/badge/version-0.8.0-7367f0)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Node.js](https://img.shields.io/badge/Node.js-24-green)

Open-source, self-hosted real-time messaging platform.

## Features

- User registration and authentication
- JWT authentication and refresh token rotation
- Direct and group conversations
- Real-time messaging via WebSockets
- Online presence and typing indicators
- Friend requests and user blocking
- Message delivery and read receipts
- Message editing, deletion and replies
- Emoji reactions
- Multimedia attachments
- User profiles and avatars
- Group administration
- Conversation muting
- Expo push notification integration

## Technology stack

NestJS, TypeScript, PostgreSQL, Prisma, Redis,
Socket.IO, Argon2id and Docker Compose.

## Docker installation

```sh
cp .env.docker.example .env

sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 64)/" .env

chmod 600 .env

docker compose up -d --build
```

## Manual installation

Requires Node.js 24, PostgreSQL and Redis.

```sh
npm ci
cp .env.example .env
```

Configure the database, Redis and JWT secret in .env.

```sh
mkdir -p storage
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start:prod
```

## API

- REST API: /api/v1
- Health endpoint: /api/v1/health
- Swagger: /docs (development only)
- Socket.IO namespace: /chat

## Security

MikosChat is currently in early development.
Messages are not end-to-end encrypted.
Some dependency security advisories remain unresolved.
Docker deployment is experimental.

Always use HTTPS and unique authentication secrets.

## Roadmap

- Android and iOS applications
- Voice and video calls
- Internationalization
- Moderation tools
- Security improvements

## License

GNU Affero General Public License v3.0 only.
See LICENSE for details.
