/**
 * Keycloak Seed Bootstrap Script
 *
 * Provisions default test/seed users from IDLMS database into Keycloak
 * realm `mod-defense`, setting their password to `Password12` and linking
 * their `keycloakId` back to the IDLMS database.
 *
 * Usage:
 *   npx ts-node prisma/seed-keycloak.ts
 */
import { PrismaClient } from '@prisma/client';
import { KeycloakAdminService } from '../src/modules/keycloak/keycloak-admin.service';
import { SEED_PASSWORD } from './seed-password';

const prisma = new PrismaClient();
const adminService = new KeycloakAdminService();

const DEV_DEFAULT_PASSWORD = process.env.KEYCLOAK_DEV_PASSWORD || SEED_PASSWORD;

async function main() {
  console.log('--- Starting Keycloak User Bootstrap ---');
  console.log(`Connecting to Keycloak Admin API...`);

  // Verify connection by getting service account token
  try {
    await adminService.getServiceAccountToken();
    console.log('Keycloak Admin API connection successful.');
  } catch (err) {
    console.error('Cannot connect to Keycloak. Is Keycloak running? Error:', (err as Error).message);
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      serviceNumber: true,
      firstName: true,
      middleName: true,
      lastName: true,
      rank: true,
      phone: true,
      email: true,
      keycloakId: true,
      unit: { select: { code: true } },
    },
  });

  console.log(`Found ${users.length} users in IDLMS database.`);

  let createdCount = 0;
  let linkedCount = 0;
  let errorCount = 0;

  for (const user of users) {
    try {
      let kcUser = await adminService.findUserByServiceNumber(user.serviceNumber);

      if (!kcUser) {
        const keycloakId = await adminService.createUser({
          serviceNumber: user.serviceNumber,
          password: DEV_DEFAULT_PASSWORD,
          firstName: user.firstName,
          middleName: user.middleName,
          lastName: user.lastName,
          rank: user.rank,
          phone: user.phone,
          email: user.email,
          unitCode: user.unit?.code ?? null,
        });

        await prisma.user.update({
          where: { id: user.id },
          data: { keycloakId, lastSyncedAt: new Date() },
        });

        console.log(`  [CREATED] ${user.serviceNumber} -> Keycloak ID ${keycloakId}`);
        createdCount++;
      } else {
        const keycloakId = kcUser.id!;
        await adminService.resetPassword(keycloakId, DEV_DEFAULT_PASSWORD);
        await adminService.setUserEnabled(keycloakId, true);
        await adminService.updateUser(keycloakId, { unitCode: user.unit?.code ?? null });

        await prisma.user.update({
          where: { id: user.id },
          data: { keycloakId, lastSyncedAt: new Date() },
        });

        console.log(`  [LINKED]  ${user.serviceNumber} -> Keycloak ID ${keycloakId} (password reset to default)`);
        linkedCount++;
      }
    } catch (err) {
      console.error(`  [FAILED]  ${user.serviceNumber}: ${(err as Error).message}`);
      errorCount++;
    }
  }

  console.log('--- Keycloak Bootstrap Summary ---');
  console.log(`Created: ${createdCount}`);
  console.log(`Linked/Reset: ${linkedCount}`);
  console.log(`Errors:  ${errorCount}`);
}

main()
  .catch((err) => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
