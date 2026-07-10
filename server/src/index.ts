import { createServer } from 'http';
import { env } from './config/env';
import { logger } from './util/logger';
import { initFirebaseAdmin } from './auth/firebaseAdmin';
import { RoomStore } from './game/store';
import { SnapshotStore } from './persistence/snapshot';
import { votersBackend } from './persistence/voters';
import { buildApp } from './app';
import { createIo } from './socket';

async function main(): Promise<void> {
  initFirebaseAdmin();

  const store = new RoomStore('lie-hard');

  // Restore prior game state (crash recovery) if a snapshot store is configured.
  const snapshots = new SnapshotStore();
  const restored = await snapshots.load();
  if (restored) store.restore(restored);

  const app = buildApp(() => store.version);
  const httpServer = createServer(app);
  const { broadcaster } = createIo(httpServer, store);

  // Periodic snapshot of authoritative state.
  const snapTimer = setInterval(() => void snapshots.save(store.snapshot()), env.SNAPSHOT_INTERVAL_MS);
  snapTimer.unref?.();

  httpServer.listen(env.PORT, '0.0.0.0', () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        voters: votersBackend(),
        snapshots: snapshots.enabled ? 'redis' : 'disabled',
        origins: env.ALLOWED_ORIGINS,
      },
      'lie-hard-server listening',
    );
  });

  // ── Graceful shutdown: snapshot once more, then close cleanly ───────────────
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(snapTimer);
    broadcaster.stop();
    await snapshots.save(store.snapshot());
    await snapshots.close();
    httpServer.close(() => process.exit(0));
    // Force-exit if connections linger.
    setTimeout(() => process.exit(0), 5000).unref?.();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.stack : e }, 'fatal boot error');
  process.exit(1);
});
