#!/usr/bin/env node
/**
 * Runs the Android Gradle wrapper with the right binary for this OS.
 * Fails with an actionable message instead of a stack trace when the toolchain
 * is missing (we hit this on machines without a JDK / Android SDK).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..');
const ANDROID_DIR = join(ROOT, 'app', 'android');
const args = process.argv.slice(2);
const isWin = process.platform === 'win32';
const wrapper = join(ANDROID_DIR, isWin ? 'gradlew.bat' : 'gradlew');

if (!existsSync(ANDROID_DIR)) {
  console.error(`
[android] app/android does not exist yet.

Run this first:
  npm run cap:add:android
`);
  process.exit(1);
}

if (!existsSync(wrapper)) {
  console.error(`[android] gradle wrapper not found at ${wrapper}`);
  process.exit(1);
}

const java = spawnSync('java', ['-version'], { encoding: 'utf8', shell: isWin });
if (java.error || java.status !== 0) {
  console.error(`
[android] A JDK is required and was not found on PATH.

Install JDK 21 (Capacitor 7 / AGP 8 needs 17+), then reopen your terminal:
  winget install --id EclipseAdoptium.Temurin.21.JDK

Also set the Android SDK location, e.g. add to app/android/local.properties:
  sdk.dir=C:\\\\Users\\\\<you>\\\\AppData\\\\Local\\\\Android\\\\Sdk
`);
  process.exit(1);
}

if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT && !existsSync(join(ANDROID_DIR, 'local.properties'))) {
  console.error(`
[android] No Android SDK configured.

Set ANDROID_HOME, or create app/android/local.properties with:
  sdk.dir=C:\\\\Users\\\\<you>\\\\AppData\\\\Local\\\\Android\\\\Sdk

Install the SDK via Android Studio (SDK Manager) or:
  winget install --id Google.AndroidStudio
`);
  process.exit(1);
}

console.log(`[android] gradlew ${args.join(' ')}`);
const res = spawnSync(wrapper, args, {
  cwd: ANDROID_DIR,
  stdio: 'inherit',
  shell: isWin,
});
process.exit(res.status ?? 1);
