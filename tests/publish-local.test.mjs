import assert from 'node:assert/strict';
import test from 'node:test';
import { options } from '../scripts/publish-local.mjs';
import { latestLinks } from '../scripts/notify-lark.mjs';

test('requires both mobile packages for one release', () => {
  assert.throws(() => options(['--apk', '/tmp/a.apk']), /Both --apk and --ipa/);
  assert.deepEqual(options(['--apk', '/tmp/a.apk', '--ipa', '/tmp/a.ipa', '--dry-run']), {
    apk: '/tmp/a.apk', ipa: '/tmp/a.ipa', dryRun: true,
  });
});

test('Lark notification uses latest links and verifies the published release was parsed', () => {
  const data = { publicUrl: 'https://example.test/', apps: [{
    id: 'shorepay-v2',
    ios: [{ tag: 'release-2', version: '2.0', installUrl: 'itms-services://install' }],
    android: [{ tag: 'release-1', version: '1.9', downloadUrl: 'https://example.test/app.apk' }],
  }] };
  assert.equal(latestLinks(data, 'release-2').entries.length, 2);
  assert.throws(() => latestLinks(data, 'release-3'), /no parsed IPA or APK/);
});
