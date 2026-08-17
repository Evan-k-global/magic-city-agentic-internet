# Production Persistence and Privacy

Magic City treats browser missions, search terms, connector state, vault metadata, payment authorization metadata, receipts, and native-runner devices as private account data.

## Current production-safe shape

- The Magic City web process uses one private Fly Managed Postgres cluster in the same region.
- `app_state` is an AES-256-GCM envelope encrypted with `MAGIC_CITY_STATE_ENCRYPTION_KEY`. The database never receives the readable state snapshot.
- The encryption key and `DATABASE_URL` are Fly secrets, not repository configuration or client-visible API data.
- Execution artifacts on the mounted volume use a separate key derivation from that same secret. They are encrypted in place before writing and only decrypted in memory after the artifact ownership check.
- The web process holds a PostgreSQL advisory lock. A second writer fails startup instead of racing a whole-state snapshot update.
- Strict mode rejects startup without Postgres, successful persistence, the writer lock, and state encryption. API responses wait for queued persistence in strict mode.
- The embedded Zeko relayer writes its submission journal to its own Postgres table and waits for each write before responding.
- Sponsored ZK proofs run in a separate loopback-only, bearer-protected, low-priority worker. Receipt creation stays on the fast web path; the worker prepares proof material and the embedded relayer submits the anchor.
- The mounted proof-key cache contains public Magic City and registry proving-key material only. It avoids repeated cold compilation after a Fly machine replacement and never holds mission inputs, task text, or user data.
- Before enabling automatic mainnet anchor draining, verify that the configured Mission Auth Registry account exists on the live Zeko endpoint. The relayer fails closed when the registry is absent; a transaction hash is a broadcast acknowledgement, not a confirmed on-chain receipt.
- Browser artifacts, receipts, anchor status, and mission trace exports require account ownership. They use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- Mission trace exports include target and detail commitments, not raw target URLs, search text, selectors, private inputs, or holder signatures.

## Required Fly secrets

`DATABASE_URL` is set through `fly mpg attach`; do not paste it into `fly.toml`.

`MAGIC_CITY_STATE_ENCRYPTION_KEY` must be a random 32-byte base64 or 64-character hex key. Store it only as a Fly secret. Rotate it through a planned decrypt-and-reencrypt migration, not by replacing it in place.

For Fly Managed Postgres, pin the private cluster CA in `DATABASE_SSL_CA` and set `DATABASE_SSL_SERVERNAME` to the certificate’s private service DNS name. This keeps `DATABASE_SSL=require` fully verified even though the attached PgBouncer URL uses Fly’s proxy alias.

## Rollout order

1. Deploy the migration-capable application without strict persistence.
2. Set the state-encryption secret.
3. Attach the private Managed Postgres cluster.
4. Confirm `/health` reports `driver: postgres`, `healthy: true`, an acquired writer lock, and enabled at-rest encryption.
5. Enable `MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE=true` and `MAGIC_CITY_REQUIRE_STATE_ENCRYPTION=true`.
6. Run `npm run check:native-runner-production` and the authenticated production smoke.
7. Only then remove legacy file snapshots from the Fly volume after retaining the encrypted database archive and a tested restore path.

After migration, do not leave `state.json`, startup backups, `state.json.previous`, or `zeko-submitter-state.json` on a production volume. The application reads legacy files only if the corresponding Postgres table is empty during the one-time import; ordinary Postgres startup never creates plaintext state backups.

## Scaling boundary

The current application state is intentionally a single encrypted snapshot with a single writer. This is durable and safe for the one-machine staging deployment, but it is not a horizontal-write architecture.

Before increasing Magic City past one writer, move these critical paths to normalized transactional tables with idempotency keys and row-level ownership checks: native runner devices, pairing sessions, connector sessions, mission events, receipts, credit accounts, escrow locks, the append-only credit ledger, merchant settlements, anchors, and the settlement outbox. Keep the advisory lock until that migration is complete.
