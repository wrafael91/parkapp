-- Checks that a restored instance has the same data and schema as production
-- (NFR-18, drill of #126). It runs, read only, as parkapp_app against production and
-- against the restored instance, and the two outputs must be equal (diff):
--
--   psql "$RP_PSQL_PROD" -X -q -At -f verify-restore.sql > /tmp/prod.txt
--   psql "$RP_PSQL_SIM"  -X -q -At -f verify-restore.sql > /tmp/sim.txt
--   diff /tmp/prod.txt /tmp/sim.txt && echo "IGUALES"
--
-- The output has no secrets: counts, md5 fingerprints and settings. Production must
-- not be used between the restore time and the check, or sesion and
-- evento_auditoria change.

\set ON_ERROR_STOP on
SET default_transaction_read_only = on;
BEGIN READ ONLY;

-- 1. Data: row count and md5 fingerprint of every row of every table, in id order.
SELECT * FROM (
SELECT 'datos', 'usuario', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM usuario t
UNION ALL SELECT 'datos', 'sesion', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM sesion t
UNION ALL SELECT 'datos', 'tope_legal', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM tope_legal t
UNION ALL SELECT 'datos', 'tarifa', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM tarifa t
UNION ALL SELECT 'datos', 'periodo_gracia', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM periodo_gracia t
UNION ALL SELECT 'datos', 'tope_periodo', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM tope_periodo t
UNION ALL SELECT 'datos', 'cupo', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM cupo t
UNION ALL SELECT 'datos', 'estadia', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM estadia t
UNION ALL SELECT 'datos', 'comprobante', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM comprobante t
UNION ALL SELECT 'datos', 'evento_auditoria', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM evento_auditoria t
) AS datos
ORDER BY 2;

-- 2. Sequences: where the next id and the next receipt number would start.
SELECT 'secuencia', sequencename, coalesce(last_value::text, 'sin usar')
FROM pg_sequences
WHERE schemaname = 'public'
ORDER BY sequencename;

-- 3. Schema: the applied migrations leave these columns, constraints, indexes and
-- enum values. parkapp_app cannot read _prisma_migrations, but the catalog is
-- readable by every role.
SELECT 'esquema', 'columnas', count(*), md5(string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' ORDER BY c.relname, a.attnum))
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped;

SELECT 'esquema', 'restricciones', count(*), md5(string_agg(c.relname || '.' || k.conname || ':' || pg_get_constraintdef(k.oid), ',' ORDER BY c.relname, k.conname))
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public';

SELECT 'esquema', 'indices', count(*), md5(string_agg(indexdef, ',' ORDER BY indexname))
FROM pg_indexes
WHERE schemaname = 'public';

SELECT 'esquema', 'enumerados', count(*), md5(string_agg(t.typname || '.' || e.enumlabel, ',' ORDER BY t.typname, e.enumsortorder))
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid;

-- 4. Settings: time zone UTC (docs/arquitectura.md, 6.2), the PostgreSQL version and
-- TLS in this connection. rds.force_ssl only exists in RDS, and parkapp_app cannot
-- read it there either (drills of November 24 and 26, 2026): the drill checks it in
-- the parameter group (README, step 3.2).
SELECT 'ajuste', 'timezone', current_setting('TimeZone');
SELECT 'ajuste', 'version', current_setting('server_version');
SELECT 'ajuste', 'rds.force_ssl', coalesce(current_setting('rds.force_ssl', true), 'no visible para este rol');
SELECT 'ajuste', 'tls', CASE WHEN ssl THEN 'si, ' || version ELSE 'no' END
FROM pg_stat_ssl
WHERE pid = pg_backend_pid();

COMMIT;
