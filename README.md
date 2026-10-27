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