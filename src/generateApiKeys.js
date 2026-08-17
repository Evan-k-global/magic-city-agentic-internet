import crypto from 'node:crypto';

const count = Math.max(1, Number(process.argv[2] || 3));
const keys = Array.from({ length: count }, () => `alpha_${crypto.randomBytes(12).toString('hex')}`);

console.log(keys.join(','));
