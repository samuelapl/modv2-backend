/**
 * One-off backfill for the self-service onboarding rollout.
 *
 *   npx ts-node prisma/backfill-onboarding.ts            # apply
 *   npx ts-node prisma/backfill-onboarding.ts --dry-run  # report only
 *
 * - Every existing driver profile gets profileStatus from the completeness rule
 *   (COMPLETE if all required fields are already filled, otherwise INCOMPLETE).
 * - Existing user accounts keep mustChangePassword = false, so nobody is locked
 *   out when this ships (the column default).
 *
 * Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import {
  missingProfileFields,
  profileStatusFor,
} from '../src/modules/personnel/helpers/profile-completeness.helper';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const drivers = await prisma.driverProfile.findMany({
    select: {
      id: true,
      serviceNumber: true,
      profileStatus: true,
      profileCompletedAt: true,
      dateOfBirth: true,
      gender: true,
      nationalIdNumber: true,
      bloodGroup: true,
      photoUrl: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
    },
  });

  let complete = 0;
  let incomplete = 0;
  let changed = 0;

  for (const d of drivers) {
    const status = profileStatusFor(d);
    status === 'COMPLETE' ? complete++ : incomplete++;

    if (status === 'INCOMPLETE') {
      console.log(`  incomplete  ${d.serviceNumber}: missing ${missingProfileFields(d).join(', ')}`);
    }
    if (status !== d.profileStatus || (status === 'COMPLETE' && !d.profileCompletedAt)) {
      changed++;
      if (!dryRun) {
        await prisma.driverProfile.update({
          where: { id: d.id },
          data: {
            profileStatus: status,
            profileCompletedAt: status === 'COMPLETE' ? d.profileCompletedAt ?? new Date() : null,
          },
        });
      }
    }
  }

  console.log(
    `${dryRun ? '[dry run] ' : ''}${drivers.length} drivers: ${complete} complete, ${incomplete} incomplete, ${changed} ${dryRun ? 'would change' : 'updated'}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
