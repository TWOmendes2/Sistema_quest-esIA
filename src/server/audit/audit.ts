import 'server-only';
import { appSchema } from '@/server/supabase/admin';

type AuditInput = {
  organizationId?: string | null;
  actorAuthUid?: string | null;
  action: string;
  entityName: string;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export async function auditLog(input: AuditInput): Promise<void> {
  const { error } = await appSchema().from('audit_logs').insert({
    organization_id: input.organizationId ?? null,
    actor_auth_uid: input.actorAuthUid ?? null,
    action: input.action,
    entity_name: input.entityName,
    entity_id: input.entityId ?? null,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    metadata: input.metadata ?? {}
  });

  if (error) {
    console.error('audit_log_failed', { action: input.action, entity: input.entityName, error: error.message });
  }
}
