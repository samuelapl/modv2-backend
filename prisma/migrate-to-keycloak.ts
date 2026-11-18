/**
 * Keycloak User Migration Script
 *
 * Scans IDLMS database accounts and migrates them to Keycloak realm `mod-defense`.
 * Supports a safe `--dry-run` mode (default) that generates a comprehensive audit report,
 * and an `--execute` mode that performs the live migration.
 *
 * Usage:
 *   npx ts-node prisma/migrate-to-keycloak.ts --dry-run
 *   npx ts-node prisma/migrate-to-keycloak.ts --execute
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { KeycloakAdminService } from '../src/modules/keycloak/keycloak-admin.service';
import { generateTempPassword } from '../src/common/utils/password.util';

const prisma = new PrismaClient();
const adminService = new KeycloakAdminService();

interface MigrationRow {
  serviceNumber: string;
  fullName: string | null;
  email: string | null;
  status: 'ALREADY_LINKED' | 'EXISTS_UNLINKED' | 'NEEDS_CREATION' | 'CONFLICT';
  keycloakId?: string;
  action: string;
  error?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isDryRun = !isExecute || args.includes('--dry-run');

  console.log('====================================================');
  console.log('       MoD IDLMS -> Keycloak Migration Tool         ');
  console.log(` Mode: ${isDryRun ? 'DRY-RUN (Simulated)' : 'EXECUTE (Live Changes)'} `);
  console.log('====================================================\n');

  try {
    await adminService.getServiceAccountToken();
    console.log('✓ Successfully connected to Keycloak Admin API.\n');
  } catch (err) {
    console.error('✗ Cannot connect to Keycloak Admin API. Check that Keycloak is running and credentials are valid.');
    console.error(`  Error: ${(err as Error).message}`);
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      serviceNumber: true,
      firstName: true,
      middleName: true,
      lastName: true,
      fullName: true,
      rank: true,
      phone: true,
      email: true,
      keycloakId: true,
      isActive: true,
      unit: { select: { code: true } },
    },
    orderBy: { serviceNumber: 'asc' },
  });

  console.log(`Found ${users.length} accounts in IDLMS database. Analyzing...\n`);

  const report: MigrationRow[] = [];
  let alreadyLinkedCount = 0;
  let existsUnlinkedCount = 0;
  let needsCreationCount = 0;
  let conflictCount = 0;

  for (const u of users) {
    try {
      const kcUser = await adminService.findUserByServiceNumber(u.serviceNumber);

      if (kcUser?.id) {
        if (u.keycloakId === kcUser.id) {
          alreadyLinkedCount++;
          report.push({
            serviceNumber: u.serviceNumber,
            fullName: u.fullName,
            email: u.email,
            status: 'ALREADY_LINKED',
            keycloakId: kcUser.id,
            action: 'No action required; already synchronized.',
          });
        } else {
          existsUnlinkedCount++;
          report.push({
            serviceNumber: u.serviceNumber,
            fullName: u.fullName,
            email: u.email,
            status: 'EXISTS_UNLINKED',
            keycloakId: kcUser.id,
            action: 'Will link IDLMS account to existing Keycloak user ID.',
          });

          if (!isDryRun) {
            await prisma.user.update({
              where: { id: u.id },
              data: { keycloakId: kcUser.id, lastSyncedAt: new Date() },
            });
          }
        }
      } else {
        needsCreationCount++;
        const tempPassword = generateTempPassword();
        report.push({
          serviceNumber: u.serviceNumber,
          fullName: u.fullName,
          email: u.email,
          status: 'NEEDS_CREATION',
          action: 'Will provision in Keycloak with temporary password.',
        });

        if (!isDryRun) {
          const createdKeycloakId = await adminService.createUser({
            serviceNumber: u.serviceNumber,
            password: tempPassword,
            firstName: u.firstName,
            middleName: u.middleName,
            lastName: u.lastName,
            rank: u.rank,
            phone: u.phone,
            email: u.email,
            unitCode: u.unit?.code ?? null,
            mustChangePassword: true,
          });

          await prisma.user.update({
            where: { id: u.id },
            data: {
              keycloakId: createdKeycloakId,
              mustChangePassword: true,
              lastSyncedAt: new Date(),
            },
          });
        }
      }
    } catch (err) {
      conflictCount++;
      report.push({
        serviceNumber: u.serviceNumber,
        fullName: u.fullName,
        email: u.email,
        status: 'CONFLICT',
        action: 'Failed analysis or provisioning.',
        error: (err as Error).message,
      });
    }
  }

  // Print Report Summary
  console.log('----------------------------------------------------');
  console.log('                 MIGRATION SUMMARY                  ');
  console.log('----------------------------------------------------');
  console.log(`Total IDLMS Accounts:        ${users.length}`);
  console.log(`Already Linked:              ${alreadyLinkedCount}`);
  console.log(`Existing in Keycloak to Link: ${existsUnlinkedCount}`);
  console.log(`Needs Keycloak Creation:     ${needsCreationCount}`);
  console.log(`Conflicts / Errors:          ${conflictCount}`);
  console.log('----------------------------------------------------\n');

  // Print sample table rows
  console.log('Sample Report Rows:');
  console.table(
    report.slice(0, 15).map((r) => ({
      'Service #': r.serviceNumber,
      Name: r.fullName || '—',
      Status: r.status,
      Action: r.action,
    })),
  );

  const reportPath = path.resolve(__dirname, 'migration-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nDetailed report written to: ${reportPath}`);

  if (isDryRun) {
    console.log('\n[INFO] Dry-run completed. No database or Keycloak changes were made.');
    console.log('       To apply these changes, run with: npm run migrate:keycloak -- --execute\n');
  } else {
    console.log('\n[SUCCESS] Migration execution completed successfully!\n');
  }
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
