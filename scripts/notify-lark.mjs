#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = 'https://open.larksuite.com/open-apis';

function requireSuccess(response, body, label) {
  const code = body?.code ?? body?.StatusCode;
  if (!response.ok || code !== 0) {
    throw new Error(`${label} failed: HTTP ${response.status}, code ${code ?? 'unknown'}, ${body?.msg ?? body?.StatusMessage ?? 'unknown'}`);
  }
  return body;
}

async function requestJson(url, options, label) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  return requireSuccess(response, body, label);
}

export function latestLinks(data, releaseTag) {
  const app = data.apps?.find(item => item.id === 'shorepay-v2') || data.apps?.[0];
  if (!app) throw new Error('Release was published, but no app was generated. Check package parsing in the build job.');
  const entries = [app.ios?.[0], app.android?.[0]].filter(Boolean);
  if (!entries.length) throw new Error('Release was published, but no installable IPA or APK was generated.');
  if (releaseTag && ![...(app.ios || []), ...(app.android || [])].some(item => item.tag === releaseTag)) {
    throw new Error(`Release ${releaseTag} has no parsed IPA or APK in apps.json.`);
  }
  return { app, entries, pageUrl: data.publicUrl };
}

async function token(appId, appSecret) {
  const body = await requestJson(`${apiRoot}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  }, 'Lark token');
  if (!body.tenant_access_token) throw new Error('Lark token response has no tenant_access_token');
  return body.tenant_access_token;
}

async function uploadQr(accessToken, url) {
  const png = await QRCode.toBuffer(url, { type: 'png', width: 360, margin: 2, errorCorrectionLevel: 'M' });
  const form = new FormData();
  form.set('image_type', 'message');
  form.set('image', new Blob([png], { type: 'image/png' }), 'shorepay-qr.png');
  const body = await requestJson(`${apiRoot}/im/v1/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  }, 'Lark image upload');
  if (!body.data?.image_key) throw new Error('Lark image upload returned no image_key');
  return body.data.image_key;
}

function versionLabel(entry) {
  return `${entry.version || entry.tag}${entry.file ? ` · ${entry.file}` : ''}`;
}

export async function sendAppCard(accessToken, chatId, links) {
  const elements = [];
  for (const entry of links.entries) {
    const platform = entry.installUrl ? 'iOS' : 'Android';
    const url = entry.installUrl || entry.downloadUrl;
    const key = await uploadQr(accessToken, url);
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `${platform} 最新版：${versionLabel(entry)}` } });
    elements.push({ tag: 'img', img_key: key, alt: { tag: 'plain_text', content: `${platform} 安装二维码` } });
  }
  elements.push({ tag: 'action', actions: [{
    tag: 'button',
    text: { tag: 'plain_text', content: '打开分发页' },
    url: links.pageUrl,
    type: 'primary',
  }] });
  const card = {
    header: { title: { tag: 'plain_text', content: 'ShorePay V2 测试版已发布' }, template: 'blue' },
    elements,
  };
  await requestJson(`${apiRoot}/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) }),
  }, 'Lark group message');
}

async function sendWebhook(webhook, links) {
  const lines = links.entries.map(entry => `${entry.installUrl ? 'iOS' : 'Android'} ${versionLabel(entry)}`);
  const body = {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: 'ShorePay V2 测试版已发布' }, template: 'blue' },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: `${lines.join('\n')}\n[打开分发页](${links.pageUrl})，页面内可查看安装二维码。` } },
      ],
    },
  };
  await requestJson(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 'Lark webhook');
}

async function main() {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  const chatId = process.env.LARK_CHAT_ID;
  const webhook = process.env.LARK_WEBHOOK_URL;
  if (!(appId && appSecret && chatId) && !webhook) {
    console.log('Lark is not configured; set LARK_APP_ID, LARK_APP_SECRET, LARK_CHAT_ID for QR images, or LARK_WEBHOOK_URL for a page link.');
    return;
  }
  const data = JSON.parse(fs.readFileSync(path.join(root, 'docs/apps.json'), 'utf8'));
  const links = latestLinks(data, process.env.RELEASE_TAG);
  if (appId && appSecret && chatId) {
    await sendAppCard(await token(appId, appSecret), chatId, links);
    console.log('Sent latest iOS/Android QR images to Lark group.');
  } else {
    await sendWebhook(webhook, links);
    console.log('Sent latest version and distribution page link to Lark webhook.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
