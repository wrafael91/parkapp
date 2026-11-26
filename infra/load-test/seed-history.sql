-- Synthetic history for the load test of NFR-14 (S3-13, #127): 100,000 stays in the
-- 333 days before the run, about 300 a day (a parking lot with 300 vehicles a day,
-- as NFR-14 says). Only for the instance restored in the drill (#126), never for
-- production: it refuses to run without -v ambiente=simulacro, without the load
-- account of the drill (carga@rolopark.test, which only exists in the restored
-- instance), and when the database already has more than 1,000 stays.
--
-- It runs as parkapp_migrator, the owner of the tables. The database grants nothing
-- to PUBLIC (docs/arquitectura.md, 6.5), so parkapp_app cannot create the temporary
-- table below ("permission denied to create temporary tables", found in AWS on
-- November 24, 2026), and only the owner can run ANALYZE at the end. The URL comes
-- from /parkapp/prod/db/url-migrator and lives only in memory (README, step 4.1):
--
--   RP_PSQL_SIM_MIG="$(RP_DB="$RP_DB_MIG" node db-url.mjs parkapp-db-simulacro psql)"
--   psql "$RP_PSQL_SIM_MIG" -X -v ambiente=simulacro -f seed-history.sql
--
-- Simplifications, acceptable because the instance is temporary: every stay uses the
-- rate, grace period and period cap in force today (RI-08 is not a trigger yet), the
-- receipts apply the period cap to stays shorter than one period only, and there are
-- no audit events (History does not read them). The stays belong to an inactive
-- account, 'semilla.carga@rolopark.invalid', that cannot sign in.

\set ON_ERROR_STOP on
\timing on

\if :{?ambiente}
\else
  \set ambiente 'sin definir'
\endif
SELECT set_config('rolopark.ambiente', :'ambiente', false) \g /dev/null

DO $$
BEGIN
  IF current_setting('rolopark.ambiente') <> 'simulacro' THEN
    RAISE EXCEPTION 'Solo para la instancia restaurada: psql -v ambiente=simulacro (recibido: %).',
      current_setting('rolopark.ambiente');
  END IF;
  IF current_user <> 'parkapp_migrator' THEN
    RAISE EXCEPTION 'Corre como parkapp_migrator, el dueño de las tablas (rol actual: %).', current_user;
  END IF;
  IF NOT EXISTS (SELECT FROM usuario WHERE correo = 'carga@rolopark.test') THEN
    RAISE EXCEPTION 'No está la cuenta de carga (README, paso 3.4): esta no parece la instancia restaurada.';
  END IF;
  IF (SELECT count(*) FROM estadia) > 1000 THEN
    RAISE EXCEPTION 'La base ya tiene más de 1.000 estadías: la semilla no se carga dos veces.';
  END IF;
  IF (SELECT count(*) FROM tarifa WHERE vigente_hasta IS NULL) < 2
     OR NOT EXISTS (SELECT FROM periodo_gracia WHERE vigente_hasta IS NULL) THEN
    RAISE EXCEPTION 'Faltan la tarifa vigente de carro y moto o el periodo de gracia.';
  END IF;
END
$$;

BEGIN;

-- The same data in every run.
SELECT setseed(0.2026) \g /dev/null

INSERT INTO usuario (nombre, correo, hash_contrasena, rol, activo, debe_cambiar_contrasena)
VALUES ('Semilla de carga', 'semilla.carga@rolopark.invalid', '!', 'OPERADOR', false, false);

-- One row per stay: the day (0 to 333), the time of entry between 6:00 and 22:00
-- in Bogotá (UTC-5 all year, ADR 0008), the duration (5 minutes to 12 hours, most
-- of them short) and the state: 1% voided, half of them after their exit.
CREATE TEMP TABLE semilla ON COMMIT DROP AS
SELECT
  g,
  tipo,
  CASE tipo
    WHEN 'CARRO' THEN letras || lpad(floor(random() * 1000)::int::text, 3, '0')
    ELSE letras || lpad(floor(random() * 100)::int::text, 2, '0') || chr(65 + floor(random() * 26)::int)
  END AS placa,
  ingreso,
  LEAST(ingreso + make_interval(mins => duracion), now() - interval '1 minute') AS salida,
  CASE WHEN r < 0.005 THEN 'ANULADA_DENTRO' WHEN r < 0.01 THEN 'ANULADA_CERRADA' ELSE 'CERRADA' END AS estado
FROM (
  SELECT
    g,
    CASE WHEN random() < 0.75 THEN 'CARRO' ELSE 'MOTO' END AS tipo,
    chr(65 + floor(random() * 26)::int) || chr(65 + floor(random() * 26)::int)
      || chr(65 + floor(random() * 26)::int) AS letras,
    ((now() AT TIME ZONE 'America/Bogota')::date - 334 + (g - 1) / 300)::timestamp AT TIME ZONE 'America/Bogota'
      + interval '6 hours' + random() * interval '16 hours' AS ingreso,
    LEAST(720, 5 + floor(-ln(1 - random()) * 90))::int AS duracion,
    random() AS r
  FROM generate_series(1, 100000) AS g
) AS s;

INSERT INTO estadia (
  placa, tipo_vehiculo, color, marca, estado, hora_ingreso, ingreso_por_id,
  tarifa_id, periodo_gracia_id, tope_periodo_id, hora_salida, salida_por_id,
  anulada_en, anulada_por_id, motivo_anulacion
)
SELECT
  s.placa,
  s.tipo::tipo_vehiculo,
  (ARRAY['Blanco', 'Gris', 'Negro', 'Rojo', 'Azul', 'Plata'])[1 + (s.g % 6)],
  CASE WHEN s.g % 3 = 0 THEN NULL ELSE (ARRAY['Chevrolet', 'Renault', 'Mazda', 'Kia', 'Yamaha', 'AKT'])[1 + (s.g % 6)] END,
  (CASE s.estado WHEN 'CERRADA' THEN 'CERRADA' ELSE 'ANULADA' END)::estado_estadia,
  s.ingreso,
  u.id,
  t.id,
  pg.id,
  tp.id,
  CASE WHEN s.estado = 'ANULADA_DENTRO' THEN NULL ELSE s.salida END,
  CASE WHEN s.estado = 'ANULADA_DENTRO' THEN NULL ELSE u.id END,
  CASE WHEN s.estado = 'CERRADA' THEN NULL ELSE s.salida + interval '2 minutes' END,
  CASE WHEN s.estado = 'CERRADA' THEN NULL ELSE u.id END,
  CASE WHEN s.estado = 'CERRADA' THEN NULL ELSE 'Semilla de la prueba de carga (S3-13)' END
FROM semilla AS s
CROSS JOIN (SELECT id FROM usuario WHERE correo = 'semilla.carga@rolopark.invalid') AS u
JOIN tarifa AS t ON t.tipo_vehiculo = s.tipo::tipo_vehiculo AND t.vigente_hasta IS NULL
CROSS JOIN (SELECT id FROM periodo_gracia WHERE vigente_hasta IS NULL) AS pg
LEFT JOIN (SELECT id FROM tope_periodo WHERE vigente_hasta IS NULL) AS tp ON true
ORDER BY s.ingreso;

-- A receipt for every stay with an exit (a voided closed stay keeps its receipt,
-- docs/modelo-datos.md, decision 5). Total: whole minutes at the rate of the stay,
-- nothing within the grace period, the period cap, and a multiple of $50 (BR-13).
INSERT INTO comprobante (estadia_id, minutos_completos, subtotal, descuento_tope, ajuste_redondeo, total)
SELECT
  id, minutos, subtotal, descuento,
  (subtotal - descuento) % 50,
  (subtotal - descuento) - (subtotal - descuento) % 50
FROM (
  SELECT
    e.id,
    m.minutos,
    m.subtotal,
    CASE WHEN tp.valor IS NULL THEN 0 ELSE GREATEST(0, m.subtotal - tp.valor) END AS descuento
  FROM estadia AS e
  JOIN tarifa AS t ON t.id = e.tarifa_id
  JOIN periodo_gracia AS pg ON pg.id = e.periodo_gracia_id
  LEFT JOIN tope_periodo AS tp ON tp.id = e.tope_periodo_id
  CROSS JOIN LATERAL (
    SELECT
      floor(extract(epoch FROM e.hora_salida - e.hora_ingreso) / 60)::int AS minutos,
      CASE
        WHEN floor(extract(epoch FROM e.hora_salida - e.hora_ingreso) / 60) <= pg.minutos THEN 0
        ELSE floor(extract(epoch FROM e.hora_salida - e.hora_ingreso) / 60)::int * t.valor_minuto
      END AS subtotal
  ) AS m
  WHERE e.hora_salida IS NOT NULL
    AND e.ingreso_por_id = (SELECT id FROM usuario WHERE correo = 'semilla.carga@rolopark.invalid')
  ORDER BY e.hora_salida
) AS c;

COMMIT;

-- Fresh statistics for the planner before the load test, without waiting for
-- autovacuum.
ANALYZE usuario, estadia, comprobante;

-- What was loaded.
SELECT estado, tipo_vehiculo, count(*) AS estadias, min(hora_ingreso) AS primera, max(hora_ingreso) AS ultima
FROM estadia
WHERE ingreso_por_id = (SELECT id FROM usuario WHERE correo = 'semilla.carga@rolopark.invalid')
GROUP BY estado, tipo_vehiculo
ORDER BY estado, tipo_vehiculo;

SELECT count(*) AS comprobantes, sum(total) AS recaudo_sintetico
FROM comprobante
WHERE estadia_id IN (
  SELECT id FROM estadia
  WHERE ingreso_por_id = (SELECT id FROM usuario WHERE correo = 'semilla.carga@rolopark.invalid')
);
