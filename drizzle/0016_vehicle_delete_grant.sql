-- 0016 (M2): FLT-04 deletes a vehicle that has no history (bookings keep it through the FK otherwise).
-- Tenant isolation still applies; photos go with it (ON DELETE CASCADE).
GRANT DELETE ON vehicles TO rentcar_app;
