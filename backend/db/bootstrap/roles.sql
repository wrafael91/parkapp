-- ParkApp database roles (ADR 0006).
-- Idempotent: safe to run more than once. Creates the roles without LOGIN and
-- without passwords; each environment enables LOGIN and sets the password
-- outside the repository (NFR-10). Not a migration: parkapp_migrator, which
-- runs the migrations, cannot create roles.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'parkapp_migrator') THEN
    CREATE ROLE parkapp_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'parkapp_app') THEN
    CREATE ROLE parkapp_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
