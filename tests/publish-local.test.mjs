import assert from 'node:assert/strict';
import test from 'node:test';
import { options } from '../scripts/publish-local.mjs';
import { latestLinks, sendAppCard } from '../scripts/notify-lark.mjs';

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

test('Lark app bot uploads two QR images and sends one group card', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const image = String(url).endsWith('/im/v1/images');
    return {
      ok: true, status: 200,
      json: async () => image ? { code: 0, data: { image_key: `image-${calls.length}` } } : { code: 0 },
    };
  };
  try {
    await sendAppCard('test-token', 'test-chat', {
      pageUrl: 'https://example.test/',
      entries: [
        { version: '2.0', file: 'app.ipa', installUrl: 'itms-services://install' },
        { version: '2.0', file: 'app.apk', downloadUrl: 'https://example.test/app.apk' },
      ],
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].init.body.get('image_type'), 'message');
    assert.equal(calls[1].init.body.get('image_type'), 'message');
    const sent = JSON.parse(calls[2].init.body);
    assert.equal(sent.receive_id, 'test-chat');
    assert.equal(sent.msg_type, 'interactive');
    assert.equal(JSON.parse(sent.content).elements.filter(element => element.tag === 'img').length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
