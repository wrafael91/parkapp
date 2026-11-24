// Builds the connection string to another RDS instance from the one of the API
// (S3-12, #126, and S3-13, #127), without printing it: the result goes to a shell
// variable and lives only in memory (ADR 0006).
//
//   RP_DB="$(aws ssm get-parameter --name /parkapp/prod/db/url-app --with-decryption \
//     --query Parameter.Value --output text --region us-east-1)"
//   RP_DB_SIM="$(RP_DB="$RP_DB" node db-url.mjs parkapp-db-simulacro)"
//   RP_PSQL_SIM="$(RP_DB="$RP_DB" node db-url.mjs parkapp-db-simulacro psql)"
//
// Every instance of the account in a region shares the end of its endpoint
// (<id>.<suffix>.us-east-1.rds.amazonaws.com), so only the first label changes.
// "api" keeps the query string as the API uses it; "psql" keeps only what libpq
// understands, and requires TLS with certificate checks (NFR-09).
const LIBPQ_PARAMS = new Set(["sslmode", "sslrootcert", "connect_timeout", "application_name"]);
const RDS_BUNDLE = "/opt/parkapp/certs/rds-global-bundle.pem";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [instance, mode = "api"] = process.argv.slice(2);
if (!/^parkapp-db(-[a-z0-9]+)*$/.test(instance ?? "") || !["api", "psql"].includes(mode)) {
  fail("Uso: RP_DB=... node db-url.mjs <parkapp-db | parkapp-db-...> [api | psql]");
}
if (!process.env.RP_DB) {
  fail("Falta RP_DB, la URL de /parkapp/prod/db/url-app.");
}

let url;
try {
  url = new URL(process.env.RP_DB);
} catch {
  fail("RP_DB no es una URL válida.");
}
const [first, ...rest] = url.hostname.split(".");
if (first !== "parkapp-db" || rest.length === 0) {
  fail("El servidor de RP_DB no es parkapp-db: no se cambió nada.");
}
url.hostname = [instance, ...rest].join(".");

if (mode === "psql") {
  for (const key of [...url.searchParams.keys()]) {
    if (!LIBPQ_PARAMS.has(key)) url.searchParams.delete(key);
  }
  url.searchParams.set("sslmode", "verify-full");
  if (!url.searchParams.has("sslrootcert")) url.searchParams.set("sslrootcert", RDS_BUNDLE);
}

process.stdout.write(url.toString());
