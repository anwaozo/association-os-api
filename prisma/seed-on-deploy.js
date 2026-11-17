// Runs the demo seed during a Netlify build only when SEED_ON_DEPLOY=true.
// The seed is idempotent (existing organizations are skipped), so leaving the
// flag on is harmless, but turn it off once the demo data is in.
if (process.env.SEED_ON_DEPLOY === 'true') {
   console.log('SEED_ON_DEPLOY=true: loading demo data');
   await import('./seed.js');
} else {
   console.log('SEED_ON_DEPLOY not set: skipping demo seed');
}
