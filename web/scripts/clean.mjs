// Cross-platform `rm -rf .next out`.
// npm runs scripts through cmd.exe on Windows, where `rm` does not exist.
import { rmSync } from 'node:fs';

for (const dir of ['.next', 'out']) {
  rmSync(dir, { recursive: true, force: true });
}
