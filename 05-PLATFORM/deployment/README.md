# Local start
1. Copy `.env.example` to `.env`; replace passwords.
2. `docker compose up -d` for PostgreSQL and Redis.
3. Apply `07-DATABASE/init.sql` to the PostgreSQL database (e.g. `docker compose exec -T postgres psql -U koruone -d koruone < 07-DATABASE/init.sql`).
4. Start Keycloak using `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` and configure realm `koru`, public PKCE client `koru-web` with localhost:3000 redirect, API audiences `koru-api` and `koru-control`, plus role claim mapper.
5. `cd 03-BACKEND/KoruOne.Api && dotnet run --urls http://localhost:5080`.
6. `cd 02-FRONTEND/koru-web && cp .env.local.example .env.local && npm install && npm run dev`.
7. Start control API separately with `dotnet run --project 04-REDIS/KoruOne.Redis.Control.Api --urls http://localhost:5090`.
This is a DEVELOPMENT BASELINE, not production-ready. Ensure environment variables match compose credentials.
