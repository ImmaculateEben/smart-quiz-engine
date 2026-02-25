import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuditAction =
  | "admin.invite"
  | "admin.role_change"
  | "institution.settings_update"
  | "exam.create"
  | "exam.publish"
  | "exam.unpublish"
  | "pin.generate"
  | "pin.validate"
  | "question.import"
  | "question.delete"
  | "question.restore";

export type AuditPayload = {
  institutionId: string;
  actorUserId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

export async function logAuditEvent(payload: AuditPayload) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("audit_log", {
    p_institution_id: payload.institutionId,
    p_action: payload.action,
    p_entity_type: payload.entityType ?? null,
    p_entity_id: payload.entityId ?? null,
    p_metadata: payload.metadata ?? {}
  });

  if (error) {
    throw error;
  }

  return data as string | null;
}
