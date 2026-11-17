// Runs the demo seed during a Netlify build only when SEED_ON_DEPLOY=true.
// The seed is idempotent (existing organizations are skipped), so leaving the
// flag on is harmless, but turn it off once the demo data is in.
if (process.env.SEED_ON_DEPLOY === 'true') {
   // On a real deployment only the platform admin is created unless asked.
   process.env.SEED_DEMO_ORGS = process.env.SEED_DEMO_ORGS || 'false';
   console.log('SEED_ON_DEPLOY=true: creating the platform admin' + (process.env.SEED_DEMO_ORGS === 'true' ? ' and sample organizations' : ''));
   await import('./seed.js');
} else {
   console.log('SEED_ON_DEPLOY not set: skipping demo seed');
}
