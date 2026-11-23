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

  const app = buildApp(() => store.version, () => ({
    snapshots: snapshots.status,
    savedAgoS: snapshots.lastSavedAt ? Math.round((Date.now() - snapshots.lastSavedAt) / 1000) : null,
  }));
  const httpServer = createServer(app);
  const { broadcaster } = createIo(httpServer, store, {
    snapshots: () => snapshots.status,
    lastSavedAt: () => snapshots.lastSavedAt,
  });

  // Periodic snapshot of authoritative state.
  // Skips the save when nothing changed (the state holds base64 photos, so a
  // needless stringify + Redis write every few seconds isn't free).
  // A failed save isn't marked done, so the next tick tries again.
  let savedVersion = store.version;
  let saving = false;
  const snapTimer = setInterval(() => {
    if (saving || store.version === savedVersion) return;
    const version = store.version;
    saving = true;
    void snapshots
      .save(store.snapshot())
      .then((ok) => {
        if (ok) savedVersion = version;
      })
      .finally(() => {
        saving = false;
      });
  }, env.SNAPSHOT_INTERVAL_MS);
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
