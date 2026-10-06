#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';
import simplePlist from 'simple-plist';

const require = createRequire(import.meta.url);
const ApkParser = require('app-info-parser/src/apk');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.resolve(process.env.SHOREPAY_APP_DIR || path.join(root, '../shorepay_project/shorepay'));
const repo = 'shorepay-project/shore_install';
const bundleId = 'com.cloudsshore.wallet';

function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function usage() {
  console.log('Usage: node scripts/publish-local.mjs --apk /absolute/app.apk --ipa /absolute/app.ipa [--dry-run]');
}

export function options(argv) {
  const result = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--dry-run') result.dryRun = true;
    else if (value === '--apk' || value === '--ipa') result[value.slice(2)] = argv[++i];
    else if (value === '--help' || value === '-h') result.help = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  if (!result.help && (!result.apk || !result.ipa)) throw new Error('Both --apk and --ipa are required for one complete release.');
  return result;
}

function ensureSource() {
  if (!fs.existsSync(path.join(appRoot, '.git'))) throw new Error(`ShorePay source repo not found: ${appRoot}`);
  const branch = run('git', ['branch', '--show-current'], appRoot);
  if (branch !== 'main_v2') throw new Error(`Expected source branch main_v2, got ${branch || '(detached)'}`);
  if (run('git', ['status', '--porcelain'], appRoot)) throw new Error('ShorePay source has uncommitted changes. Publish a reviewed main_v2 commit.');
  const commit = run('git', ['rev-parse', 'HEAD'], appRoot);
  let published;
  try { published = run('git', ['rev-parse', '--verify', 'refs/remotes/origin/main_v2'], appRoot); }
  catch { throw new Error('origin/main_v2 is missing. Publish and fetch the reviewed release branch first.'); }
  if (published !== commit) throw new Error('Local main_v2 does not match origin/main_v2. Publish the reviewed commit first.');
  return { branch, commit };
}

function ensureFile(file, extension) {
  const absolute = path.resolve(file);
  if (path.extname(absolute).toLowerCase() !== extension || !fs.statSync(absolute).isFile()) {
    throw new Error(`Expected a ${extension} file: ${absolute}`);
  }
  if (fs.statSync(absolute).size >= 2 * 1024 ** 3) throw new Error(`${extension} exceeds GitHub's 2 GiB per-asset limit`);
  return absolute;
}

function parseIpa(file) {
  const zip = new AdmZip(file);
  const entries = zip.getEntries();
  const info = entries.find(entry => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry.entryName));
  if (!info) throw new Error('IPA has no Payload/*.app/Info.plist');
  const plist = simplePlist.parse(info.getData());
  if (plist.CFBundleIdentifier !== bundleId) throw new Error(`IPA bundle ID is ${plist.CFBundleIdentifier}, expected ${bundleId}`);
  const appPrefix = path.posix.dirname(info.entryName);
  const provision = entries.find(entry => entry.entryName === `${appPrefix}/embedded.mobileprovision`);
  if (!provision) {
    throw new Error('IPA has no embedded.mobileprovision; Ad Hoc distribution cannot be verified.');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shore-install-ipa-'));
  try {
    const profilePath = path.join(dir, 'embedded.mobileprovision');
    fs.writeFileSync(profilePath, provision.getData());
    const profile = simplePlist.parse(run('security', ['cms', '-D', '-i', profilePath]));
    if (!Array.isArray(profile.ProvisionedDevices) || !profile.ProvisionedDevices.length) {
      throw new Error('IPA profile has no registered devices; use an Ad Hoc provisioning profile.');
    }
    execFileSync('unzip', ['-q', file, '-d', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    const appPath = path.join(dir, appPrefix);
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { version: String(plist.CFBundleShortVersionString || ''), build: String(plist.CFBundleVersion || '') };
}

function verifyApkSigning(file) {
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
  const buildTools = path.join(sdk, 'build-tools');
  if (!fs.existsSync(buildTools)) throw new Error('Android SDK build-tools not found; apksigner is required.');
  const signer = fs.readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map(version => path.join(buildTools, version, 'apksigner')).find(filePath => fs.existsSync(filePath));
  if (!signer) throw new Error('apksigner not found in Android SDK build-tools.');
  const report = run(signer, ['verify', '--verbose', '--print-certs', file]);
  if (/CN=Android Debug/i.test(report)) throw new Error('APK is signed with an Android Debug certificate. Configure a release signing key before publishing.');
}

async function parseApk(file) {
  verifyApkSigning(file);
  const info = await new ApkParser(file).parse();
  if (info.package !== bundleId) throw new Error(`APK applicationId is ${info.package}, expected ${bundleId}`);
  return { version: String(info.versionName || ''), build: String(info.versionCode || '') };
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help) { usage(); return; }
  const source = ensureSource();
  const apk = ensureFile(opts.apk, '.apk');
  const ipa = ensureFile(opts.ipa, '.ipa');
  const [android, ios] = await Promise.all([parseApk(apk), Promise.resolve(parseIpa(ipa))]);
  if (!android.version || android.version !== ios.version) {
    throw new Error(`APK version ${android.version} and IPA version ${ios.version} differ`);
  }
  const version = android.version;
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, 'Z');
  const tag = `shorepay-v2-${version}-${source.commit.slice(0, 8)}-${timestamp}`;
  const assets = [
    `${apk}#ShorePay-v2-${version}-${android.build}.apk`,
    `${ipa}#ShorePay-v2-${version}-${ios.build}.ipa`,
  ];
  console.log(`Source: ${source.branch} ${source.commit}`);
  console.log(`Android: ${version} (${android.build})`);
  console.log(`iOS: ${version} (${ios.build})`);
  console.log(`Release: ${tag}`);
  if (opts.dryRun) { console.log('Dry run: no release created.'); return; }
  run('gh', ['auth', 'status']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shore-install-release-'));
  const notes = path.join(dir, 'notes.md');
  fs.writeFileSync(notes, [
    'Distribution-Group-ID: shorepay-v2',
    '',
    `ShorePay V2 ${version} internal test build`,
    `Source: ${source.commit} (${source.branch})`,
    `Android build: ${android.build}`,
    `iOS build: ${ios.build}`,
    '',
    'iOS installation requires a registered device and matching Ad Hoc provisioning profile.',
  ].join('\n'));
  try {
    const output = run('gh', ['release', 'create', tag, ...assets, '--repo', repo, '--target', 'main', '--title', `ShorePay V2 ${version}`, '--notes-file', notes]);
    console.log(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
