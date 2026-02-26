import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthContext, InstitutionRole, PlatformRole } from "@/lib/auth/rbac";

function isRecoverableAuthSessionError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const authError = error as {
    name?: string;
    message?: string;
    status?: number;
    __isAuthError?: boolean;
  };

  if (authError.name === "AuthSessionMissingError") return true;
  if (typeof authError.message === "string" && authError.message.includes("Auth session missing")) return true;
  if (authError.__isAuthError && (authError.status === 400 || authError.status === 401)) return true;

  return false;
}

export async function getCurrentSessionUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (isRecoverableAuthSessionError(error)) {
      return null;
    }
    throw error;
  }

  return data.user;
}

export type AdminMembership = {
  institutionId: string;
  role: InstitutionRole;
  isActive: boolean;
  institution?: {
    id: string;
    name: string;
    slug: string;
    status: string;
    timezone?: string | null;
    locale?: string | null;
  } | null;
};

export type SessionAuthState = {
  user: User | null;
  profile: {
    displayName: string | null;
    platformRole: PlatformRole | null;
  } | null;
  memberships: AdminMembership[];
  context: AuthContext | null;
};

export async function getSessionAuthState(): Promise<SessionAuthState> {
  const supabase = await createSupabaseServerClient();
  const { data: userResult, error: userError } = await supabase.auth.getUser();

  if (userError) {
    if (isRecoverableAuthSessionError(userError)) {
      return {
        user: null,
        profile: null,
        memberships: [],
        context: null
      };
    }
    throw userError;
  }

  const user = userResult.user;
  if (!user) {
    return {
      user: null,
      profile: null,
      memberships: [],
      context: null
    };
  }

  const { data: profileRow } = await supabase
    .from("user_profiles")
    .select("display_name, platform_role")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: membershipRows } = await supabase
    .from("institution_admins")
    .select("institution_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  const baseMemberships = ((membershipRows ?? []) as Array<{
    institution_id: string;
    role: InstitutionRole;
    is_active: boolean;
  }>).map((row) => ({
    institutionId: row.institution_id,
    role: row.role,
    isActive: row.is_active
  }));

  const institutionIds = [...new Set(baseMemberships.map((m) => m.institutionId))];
  let institutionMap = new Map<string, AdminMembership["institution"]>();

  if (institutionIds.length > 0) {
    const { data: institutions } = await supabase
      .from("institutions")
      .select("id, name, slug, status, timezone, locale")
      .in("id", institutionIds);

    institutionMap = new Map(
      ((institutions ?? []) as Array<{
        id: string;
        name: string;
        slug: string;
        status: string;
        timezone?: string | null;
        locale?: string | null;
      }>).map((institution) => [institution.id, institution])
    );
  }

  const memberships: AdminMembership[] = baseMemberships.map((membership) => ({
    ...membership,
    institution: institutionMap.get(membership.institutionId) ?? null
  }));

  const platformRole =
    (profileRow?.platform_role as PlatformRole | null | undefined) ?? null;
  const primaryMembership = memberships[0] ?? null;

  return {
    user,
    profile: profileRow
      ? {
          displayName: (profileRow.display_name as string | null | undefined) ?? null,
          platformRole
        }
      : null,
    memberships,
    context: {
      userId: user.id,
      institutionId: primaryMembership?.institutionId ?? null,
      platformRole,
      institutionRole: primaryMembership?.role ?? null
    }
  };
}
