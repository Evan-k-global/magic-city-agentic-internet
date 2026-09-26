import '../src/securityBootstrap.js';
import { deploymentIsProduction, createRequestSecurity } from '../src/deploymentSecurity.js';

createRequestSecurity();
if (!deploymentIsProduction()) {
  console.error('Production security profile is not enabled. See docs/production-security.md.');
  process.exitCode = 1;
} else {
  console.log('Production configuration passed static validation. Verify database readiness, restore, proxy and browser integration before release.');
}
