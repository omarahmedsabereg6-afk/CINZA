#!/usr/bin/env node
/**
 * Builds the iOS app. Only possible on macOS with Xcode — says so plainly
 * instead of failing obscurely.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..');
const IOS_DIR = join(ROOT, 'app', 'ios', 'App');

if (process.platform !== 'darwin') {
  console.error(`
[ios] iOS builds require macOS with Xcode — Apple does not allow building iOS
      apps on ${process.platform}.

The ios/ Xcode project IS generated and committed-ready. To build it:
  1. Move/clone the repo to a Mac
  2. npm install
  3. npm run cap:add:ios     (if ios/ was not copied over)
  4. npm run ios:build
`);
  process.exit(1);
}

if (!existsSync(IOS_DIR)) {
  console.error('[ios] app/ios/App not found. Run: npm run cap:add:ios');
  process.exit(1);
}

console.log('[ios] npx cap sync ios is handled by the npm script; running xcodebuild…');
const res = spawnSync(
  'xcodebuild',
  ['-workspace', 'App.xcworkspace', '-scheme', 'App', '-configuration', 'Release', '-sdk', 'iphoneos', 'build'],
  { cwd: IOS_DIR, stdio: 'inherit' }
);
process.exit(res.status ?? 1);
