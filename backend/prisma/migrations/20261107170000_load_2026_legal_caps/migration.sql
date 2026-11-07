-- 2026 legal caps (BR-10, BR-15): Decreto 652 de 2025, art. 200, Tabla 10, as
-- amended by Decreto 026 de 2026. Its article 3 makes it effective on its
-- publication in the Registro Distrital (No. 8507, 27 January 2026).
-- One current cap per vehicle type (RI-07): the general cap. With the Sello Oro
-- certification the caps are 253 and 177; a parking lot with it needs a new
-- migration that closes these rows and inserts those caps.
INSERT INTO tope_legal (tipo_vehiculo, valor_minuto, con_sello_oro, norma, vigente_desde)
VALUES
  ('CARRO', 230, false, 'Decreto 652 de 2025, art. 200, Tabla 10 (modificado por el Decreto 026 de 2026)', '2026-01-27 00:00:00-05'),
  ('MOTO', 161, false, 'Decreto 652 de 2025, art. 200, Tabla 10 (modificado por el Decreto 026 de 2026)', '2026-01-27 00:00:00-05');
