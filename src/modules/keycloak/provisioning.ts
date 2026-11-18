import { Logger } from '@nestjs/common';
import { SystemRole } from '@prisma/client';

const logger = new Logger('KeycloakProvisioning');

/**
 * Roles given to a person who is auto-provisioned from Keycloak (sync or first login).
 * Each platform sets its own default via DEFAULT_ROLE (comma-separated SystemRole values),
 * so Keycloak never needs to know this platform's roles. Set DEFAULT_ROLE="" for no roles.
 */
export function getDefaultRoles(): SystemRole[] {
  const raw = process.env.DEFAULT_ROLE ?? SystemRole.STAFF_DRIVER;
  const valid = new Set<string>(Object.values(SystemRole));
  const roles: SystemRole[] = [];
  for (const part of raw.split(',')) {
    const role = part.trim().toUpperCase();
    if (!role) continue;
    if (valid.has(role)) roles.push(role as SystemRole);
    else logger.warn(`Ignoring unknown DEFAULT_ROLE value "${part.trim()}".`);
  }
  return roles;
}

/**
 * Which Keycloak users the sync brings into IDLMS.
 *  - "realm" (default): everyone in the realm, so anyone created in Keycloak appears.
 *  - "group": only members of KEYCLOAK_SYNC_GROUP, for a realm shared with systems whose
 *    users should not appear here.
 */
export function getSyncScope(): 'realm' | 'group' {
  return (process.env.KEYCLOAK_SYNC_SCOPE ?? 'realm').trim().toLowerCase() === 'group' ? 'group' : 'realm';
}

/** Keycloak creates a user for each client's service account; those are not people. */
export function isServiceAccount(user: { username?: string; serviceAccountClientId?: string }): boolean {
  return Boolean(user.serviceAccountClientId) || (user.username ?? '').startsWith('service-account-');
}

/** Minimal Prisma surface needed to resolve a unit, so callers can pass PrismaService. */
interface UnitLookup {
  organizationalUnit: {
    findUnique(args: { where: { code: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
}

/** Resolves a Keycloak `unitCode` attribute to an OrganizationalUnit id (null if absent/unknown). */
export async function resolveUnitId(prisma: UnitLookup, unitCode: string | null | undefined): Promise<string | null> {
  const code = unitCode?.trim();
  if (!code) return null;
  const unit = await prisma.organizationalUnit.findUnique({ where: { code }, select: { id: true } });
  if (!unit) logger.warn(`Keycloak unitCode "${code}" does not match any organizational unit.`);
  return unit?.id ?? null;
}

interface UnitCodeLookup {
  organizationalUnit: {
    findUnique(args: { where: { id: string }; select: { code: true } }): Promise<{ code: string } | null>;
  };
}

/** The code of an organizational unit, as stored in the Keycloak `unitCode` attribute. */
export async function unitCodeFor(prisma: UnitCodeLookup, unitId: string | null | undefined): Promise<string | null> {
  if (!unitId) return null;
  const unit = await prisma.organizationalUnit.findUnique({ where: { id: unitId }, select: { code: true } });
  return unit?.code ?? null;
}

/** The user fields a driver profile is built from. */
export interface ProvisionedUser {
  id: string;
  serviceNumber: string;
  roles: string[];
  unitId: string | null;
  fullName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  rank: string | null;
  phone: string | null;
}

interface ProfileWriter {
  driverProfile: {
    // Prisma's generic arg types can't be matched structurally, so keep this loose.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert(args: any): PromiseLike<{ profileStatus: string }>;
  };
}

/**
 * Gives a newly provisioned driver an INCOMPLETE DriverProfile, exactly like the
 * "register driver" path does, so they show up in the driver list and are sent
 * through the complete-profile wizard. Needs a unit (the profile requires one), so a
 * user with no resolvable unit is skipped. Idempotent.
 */

export async function ensureDriverProfile(
  prisma: ProfileWriter,
  user: ProvisionedUser,
): Promise<{ profileStatus: string } | null> {
  if (!user.roles.includes(SystemRole.STAFF_DRIVER)) return null;
  if (!user.unitId) {
    logger.warn(
      `No driver profile created for ${user.serviceNumber}: no unit. Set the Keycloak "unitCode" attribute to a valid unit code.`,
    );
    return null;
  }
  return prisma.driverProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      serviceNumber: user.serviceNumber,
      fullName: user.fullName ?? user.serviceNumber,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      rank: user.rank,
      contactPhone: user.phone,
      unitId: user.unitId,
    },
    update: {},
  });
}
