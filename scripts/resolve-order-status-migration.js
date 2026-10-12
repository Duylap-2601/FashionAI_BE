const { execFileSync } = require('node:child_process');
const path = require('node:path');

const migrationName = '202610070001_order_status_simplification_release_a';
const prismaCli = path.join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');

try {
  execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'resolve', '--rolled-back', migrationName],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  console.log(`[migration-recovery] Resolved failed migration ${migrationName} as rolled back.`);
  process.exit(0);
} catch (error) {
  const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;

  if (output.includes('P3011') || output.includes('P3008')) {
    console.log(`[migration-recovery] No failed ${migrationName} record to resolve; continuing.`);
    process.exit(0);
  }

  console.error(output.trim() || `[migration-recovery] Failed to resolve ${migrationName}.`);
  process.exit(error.status || 1);
}
