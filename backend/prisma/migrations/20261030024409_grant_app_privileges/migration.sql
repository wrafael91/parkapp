-- Least-privilege grants for parkapp_app (ADR 0006, NFR-12).
-- The roles are created by db/bootstrap/roles.sql, outside the migrations.
-- Column-level UPDATE only where a rule forbids editing the other columns.

GRANT USAGE ON SCHEMA public TO parkapp_app;

-- usuario: created and updated, never deleted (RI-13)
GRANT SELECT, INSERT, UPDATE ON usuario TO parkapp_app;
GRANT USAGE ON SEQUENCE usuario_id_seq TO parkapp_app;

-- sesion
GRANT SELECT, INSERT, UPDATE ON sesion TO parkapp_app;
GRANT USAGE ON SEQUENCE sesion_id_seq TO parkapp_app;

-- tope_legal: read only; it changes only through migrations (BR-15)
GRANT SELECT ON tope_legal TO parkapp_app;

-- tarifa and periodo_gracia: versions are only closed, never edited (RI-08)
GRANT SELECT, INSERT ON tarifa TO parkapp_app;
GRANT UPDATE (vigente_hasta) ON tarifa TO parkapp_app;
GRANT USAGE ON SEQUENCE tarifa_id_seq TO parkapp_app;

GRANT SELECT, INSERT ON periodo_gracia TO parkapp_app;
GRANT UPDATE (vigente_hasta) ON periodo_gracia TO parkapp_app;
GRANT USAGE ON SEQUENCE periodo_gracia_id_seq TO parkapp_app;

-- estadia: entry data is never edited; corrections use replacement (BR-17)
GRANT SELECT, INSERT ON estadia TO parkapp_app;
GRANT UPDATE (estado, hora_salida, salida_por_id, anulada_en, anulada_por_id, motivo_anulacion) ON estadia TO parkapp_app;
GRANT USAGE ON SEQUENCE estadia_id_seq TO parkapp_app;

-- comprobante: immutable once issued (RI-12)
GRANT SELECT, INSERT ON comprobante TO parkapp_app;
GRANT USAGE ON SEQUENCE comprobante_id_seq, comprobante_consecutivo_seq TO parkapp_app;

-- evento_auditoria: insert-only log (NFR-12)
GRANT SELECT, INSERT ON evento_auditoria TO parkapp_app;
GRANT USAGE ON SEQUENCE evento_auditoria_id_seq TO parkapp_app;
