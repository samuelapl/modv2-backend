import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { signCredentialPayloadAsymmetric } from '../src/modules/credentials/helpers/qr-signer.helper';

const prisma = new PrismaClient();

async function upgradeSignatures() {
  console.log('Fetching all issued credentials to upgrade QR signatures to IDLMS2 Ed25519...');
  const credentials = await prisma.issuedCredential.findMany({
    include: {
      driverProfile: true,
      categories: { include: { category: true } },
    },
  });

  console.log(`Found ${credentials.length} credentials to upgrade.`);

  let updatedCount = 0;
  for (const cred of credentials) {
    const cats = cred.categories.map((c) => c.category.code);
    const newQrSignature = signCredentialPayloadAsymmetric({
      cred: cred.credentialNumber,
      serial: cred.serialNumber,
      drv: cred.driverProfile.serviceNumber,
      name: cred.driverProfile.fullName || undefined,
      nameAm: cred.driverProfile.fullNameAm || undefined,
      rank: cred.driverProfile.rank || undefined,
      cats,
      iss: cred.issueDate.toISOString(),
      exp: cred.expiryDate.toISOString(),
    });

    await prisma.issuedCredential.update({
      where: { id: cred.id },
      data: { qrHashSignature: newQrSignature },
    });
    updatedCount++;
  }

  console.log(`Successfully upgraded ${updatedCount} credentials to IDLMS2 Ed25519 with full name and issue date!`);
}

upgradeSignatures()
  .catch((err) => {
    console.error('Upgrade failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
