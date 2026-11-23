import { monitorEventLoopDelay } from 'perf_hooks';

/**
 * How long work waited for the server's single thread, as the worst stall in
 * each of the last few seconds. Separate from /healthz's window (which resets
 * on every read) so the operator's status strip and a health check don't
 * reset each other.
 */
const SECONDS = 10;
const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();
const recent: number[] = [];

const timer = setInterval(() => {
  recent.push(Math.round(histogram.max / 1e6));
  if (recent.length > SECONDS) recent.shift();
  histogram.reset();
}, 1000);
timer.unref?.();

/** Worst stall in the last ~10 seconds, in ms. */
export function worstStallMs(): number {
  return recent.length ? Math.max(...recent) : 0;
}
