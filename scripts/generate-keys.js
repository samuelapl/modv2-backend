// Generates an Ed25519 signing key pair for MoD credential QR codes.
// Usage: npm run keys:generate        (prints env lines to the terminal)
// Keep the private key secret: put it in a secrets manager / the server
// environment, never in git. Only the public key goes to the mobile app.
const crypto = require('crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
const raw = der.subarray(der.length - 32);
const kid = `mod-${new Date().getFullYear()}-${raw.subarray(0, 4).toString('hex')}`;
// .env needs the PEM on one line, with a literal backslash-n between lines.
const oneLine = (pem) => pem.trim().split('\n').join(String.fromCharCode(92) + 'n');
console.log(`ED25519_KEY_ID="${kid}"`);
console.log(`ED25519_PRIVATE_KEY_PEM="${oneLine(privateKey)}"`);
console.log(`ED25519_PUBLIC_KEY_PEM="${oneLine(publicKey)}"`);
console.error(`\nPublic key (hex) for the mobile app: ${raw.toString('hex')}`);
