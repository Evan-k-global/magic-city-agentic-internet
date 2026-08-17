const baseUrl = process.env.MAGIC_CITY_BASE_URL || process.argv[2] || 'http://127.0.0.1:4411';
const requireProduction = process.env.MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE === 'true'
  || process.env.FLY_APP_NAME
  || process.env.NODE_ENV === 'production';

async function main() {
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/health`);
  } catch (error) {
    const cause = error?.cause;
    throw new Error(`health_fetch_failed:${JSON.stringify({
      baseUrl,
      message: error?.message || String(error),
      causeMessage: cause?.message || null,
      causeCode: cause?.code || null,
      causeName: cause?.name || null
    })}`);
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`health_failed:${response.status}:${JSON.stringify(data)}`);
  }
  const persistence = data.persistence || {};
  const driver = String(persistence.driver || '').toLowerCase();
  const databaseConfigured = Boolean(persistence.databaseConfigured);
  const ready = Boolean(persistence.ready);
  const healthy = Boolean(persistence.healthy);
  const atRestEncryption = Boolean(persistence.atRestEncryption?.enabled);
  const writerLockReady = !persistence.singleWriterRequired || Boolean(persistence.writerLockAcquired);
  const checks = {
    baseUrl,
    driver,
    databaseConfigured,
    ready,
    healthy,
    atRestEncryption,
    writerLockReady,
    requireProduction: Boolean(requireProduction),
    nativeRunnerDevicesDurable: driver === 'postgres' && databaseConfigured && ready && healthy && atRestEncryption && writerLockReady
  };
  if (requireProduction && !checks.nativeRunnerDevicesDurable) {
    throw new Error(`native_runner_devices_not_production_durable:${JSON.stringify(checks)}`);
  }
  console.log(JSON.stringify({
    ok: true,
    checks,
    note: checks.nativeRunnerDevicesDurable
      ? 'Native runner device state is backed by the configured database.'
      : 'File-backed state is acceptable only for local/single-instance development.'
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
