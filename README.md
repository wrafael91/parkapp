# RoloPark

[![CI](https://github.com/wrafael91/parkapp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/wrafael91/parkapp/actions/workflows/ci.yml)

RoloPark is a parking management system for small and medium off-street parking lots in Bogotá, Colombia. It records vehicle entries and exits, calculates the per-minute fee under the city's current regulation (Decreto 652 de 2025, as amended by Decreto 026 de 2026), and keeps an audit trail of every operation.

Undergraduate thesis project, Software Engineering, Politécnico Grancolombiano (2026). Live at https://rolopark.com.

RoloPark is the visible name. Internal identifiers (the repository, packages, AWS resources, database roles, parameters and service) keep the name `parkapp` ([ADR 0010](docs/adr/0010-nombre-visible-rolopark.md)).

**Stack:** Node.js, Express, Prisma, PostgreSQL, React (Vite), Nginx, AWS (EC2, RDS, Systems Manager).

## Documentation (in Spanish)

- [Business rules](docs/reglas-de-negocio.md)
- [Requirements](docs/requisitos.md)
- [Data model](docs/modelo-datos.md)
- [Architecture](docs/arquitectura.md) and [decision records](docs/adr/)
- [Threat model](docs/modelo-amenazas.md)

## Run the API locally

Requirements: Node.js 22.12 or later and Docker Desktop.

```bash
cd backend
cp .env.example .env      # set a real password in POSTGRES_PASSWORD and DATABASE_URL
docker compose up -d      # PostgreSQL 16 on 127.0.0.1:5432
npm install
npx prisma migrate deploy # apply the migrations
npm run dev               # API on http://127.0.0.1:3000
```

Check that it works:

```bash
curl http://127.0.0.1:3000/api/salud
```

It returns `{"estado":"ok"}`, or `503` with `{"estado":"no_disponible"}` if the database is down.

| Script | What it does |
|---|---|
| `npm run dev` | Runs the API and restarts it on every change |
| `npm test` | Runs the tests (the database must be running) |
| `npm run build` | Compiles the API to `dist/` |
| `npm start` | Runs the compiled API |

### Database roles

The API and the migrations use two database roles defined in `backend/db/bootstrap/roles.sql` (ADR 0006). A new local database gets them automatically through docker-compose. If your Docker volume was created before this script existed, run it once before applying the migrations:

```powershell
Get-Content db/bootstrap/roles.sql | docker exec -i parkapp-db psql -U parkapp -d parkapp_dev -v ON_ERROR_STOP=1
```

On macOS or Linux: `docker exec -i parkapp-db psql -U parkapp -d parkapp_dev -v ON_ERROR_STOP=1 < db/bootstrap/roles.sql`

## Run the web app locally

Requirements: the API running on `http://127.0.0.1:3000` (see above).

```bash
cd web
npm install
npm run dev               # web app on http://localhost:5173
```

Vite forwards `/api` to the local API, so the page and the API share the same origin, as they do in production behind Nginx (ADR 0002). The page shows the sign-in form, or the active session.

| Script | What it does |
|---|---|
| `npm run dev` | Runs the web app and reloads it on every change |
| `npm test` | Runs the web tests (Vitest and Testing Library, no API needed) |
| `npm run build` | Type-checks and builds the web app to `dist/` |
| `npm run preview` | Serves the build from `dist/` |

## Bootstrap a new environment

There is no public sign-up. Two scripts, compiled to `backend/dist/scripts/`, create the first administrator and load the per-minute rates and the grace period, which every entry needs. On the server they run through Session Manager (no SSH), in `/opt/parkapp/current`, with the `parkapp_app` database URL from Parameter Store and never with the master user (ADR 0006). Locally, run `npm run build` and use the `DATABASE_URL` of your `.env`.

The legal caps are not set by the scripts: a migration loads them, and its commit cites the decree (BR-15). `npx prisma migrate deploy` (or each deploy) applies it.

Read the database URL once, without printing it:

```bash
RP_DB="$(aws ssm get-parameter --name /parkapp/prod/db/url-app --with-decryption --query Parameter.Value --output text --region us-east-1)"
```

### 1. Create the first administrator

The password goes through standard input, so it never appears in the shell history, the process list or the output. It must have 15 to 64 characters (NFR-02), and the account must change it on its first sign-in (RI-16). Running the script again with the same email changes nothing.

```bash
read -rs -p "Password: " RP_PASSWORD; echo
read -rs -p "Repeat it: " RP_PASSWORD2; echo
[ "$RP_PASSWORD" = "$RP_PASSWORD2" ] && echo "They match" || echo "They do NOT match"
printf '%s' "$RP_PASSWORD" | DATABASE_URL="$RP_DB" node dist/scripts/create-admin.js <email> "<name>"
unset RP_PASSWORD RP_PASSWORD2
```

### 2. Load the rates and the grace period

```bash
DATABASE_URL="$RP_DB" node dist/scripts/set-rates.js <email> <car> <motorcycle> <grace>
unset RP_DB
```

- `<email>`: an active administrator account, saved as the one who created the versions.
- `<car>` and `<motorcycle>`: pesos per minute, VAT included (BR-09); whole numbers greater than zero and not above the current legal cap (BR-10).
- `<grace>`: whole minutes, 0 or more (BR-08).

Each run creates a new version of the three values and closes the current ones; vehicles already inside keep the values they entered with (BR-11). If one value is rejected, nothing changes. Each change is recorded in the audit log as `TARIFA_CAMBIADA` or `PERIODO_GRACIA_CAMBIADO`.
