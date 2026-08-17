function databaseHostname(connectionString = '') {
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function urlRequestsNoTls(connectionString = '') {
  try {
    const sslMode = new URL(connectionString).searchParams.get('sslmode');
    return ['disable', 'allow', 'prefer'].includes(String(sslMode || '').toLowerCase());
  } catch {
    return false;
  }
}

function isPrivateDatabaseHost(hostname = '') {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.internal');
}

export function buildPostgresPoolOptions({ connectionString = '', requirePersistence = false } = {}) {
  const databaseSsl = String(process.env.DATABASE_SSL || 'auto').trim().toLowerCase();
  const databaseSslCa = String(process.env.DATABASE_SSL_CA || '').replace(/\\n/g, '\n');
  const databaseSslServername = String(process.env.DATABASE_SSL_SERVERNAME || '').trim();
  const hostname = databaseHostname(connectionString);
  const privateHost = isPrivateDatabaseHost(hostname);
  const explicitDisable = databaseSsl === 'disable' || urlRequestsNoTls(connectionString);

  if (explicitDisable && requirePersistence && !privateHost) {
    throw new Error('database_tls_required_for_non_private_host');
  }

  const ssl = explicitDisable || (databaseSsl === 'auto' && privateHost)
    ? undefined
    : {
        rejectUnauthorized: true,
        ...(databaseSslCa ? { ca: databaseSslCa } : {}),
        ...(databaseSslServername
          ? {
              servername: databaseSslServername,
              // Fly's private PgBouncer URL is an alias. Verify the certificate
              // against its pinned private service DNS name, not the alias host.
              checkServerIdentity: (_host, certificate) => tls.checkServerIdentity(databaseSslServername, certificate)
            }
          : {})
      };

  return { connectionString, ssl };
}
import tls from 'node:tls';
