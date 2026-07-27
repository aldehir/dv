import { rmSync } from 'node:fs';
import { COMMENTS_PATH } from '../playwright.config';

export default function globalSetup(): void {
  for (const path of [COMMENTS_PATH, `${COMMENTS_PATH}.bak`]) {
    rmSync(path, { force: true });
  }
}
