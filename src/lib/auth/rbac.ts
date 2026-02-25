export type PlatformRole = "super_admin";
export type InstitutionRole = "owner" | "admin" | "editor" | "viewer";

export type AuthContext = {
  userId: string;
  institutionId?: string | null;
  platformRole?: PlatformRole | null;
  institutionRole?: InstitutionRole | null;
};

export function hasInstitutionRole(
  context: AuthContext,
  allowed: InstitutionRole[]
): boolean {
  if (context.platformRole === "super_admin") return true;
  if (!context.institutionRole) return false;
  return allowed.includes(context.institutionRole);
}

export function assertInstitutionAccess(
  context: AuthContext,
  institutionId: string
): void {
  if (context.platformRole === "super_admin") return;
  if (!context.institutionId || context.institutionId !== institutionId) {
    throw new Error("Forbidden: cross-tenant access denied");
  }
}
