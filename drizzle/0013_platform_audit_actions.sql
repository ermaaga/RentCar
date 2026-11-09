-- 0013 (M1): platform audit actions for the console lifecycle (docs/06-backend-api.md TEN-04..06, SUB-02).
-- Adds tenant.updated, tenant.reactivated and subscription.renewed to the closed list of 0011.
ALTER TABLE platform_audit DROP CONSTRAINT platform_audit_action_check;
ALTER TABLE platform_audit ADD CONSTRAINT platform_audit_action_check CHECK (action IN (
  'tenant.created', 'tenant.updated', 'tenant.suspended', 'tenant.reactivated', 'tenant.terminated',
  'tenant.hard_deleted', 'admin.reset', 'admin.replaced', 'subscription.created',
  'subscription.updated', 'subscription.renewed', 'subscription.cancelled'));
