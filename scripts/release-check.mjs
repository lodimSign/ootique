import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', 'asset must be a PNG');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

const app = (await readJson('app.json')).expo;
const eas = await readJson('eas.json');
const metadata = await readFile('docs/app-store-metadata.md', 'utf8');
const policy = await readFile('docs/index.html', 'utf8');

assert.equal(app.ios.bundleIdentifier, 'com.lodim.ootique');
assert.match(app.ios.buildNumber, /^\d+$/);
assert.equal(app.ios.supportsTablet, false);
assert.equal(app.splash.image, './assets/splash-icon.png');
assert.equal(app.plugins.some((plugin) => plugin === 'expo-iap'), true);
assert.deepEqual(pngSize(await readFile('assets/icon.png')), [1024, 1024]);
assert.deepEqual(pngSize(await readFile('assets/splash-icon.png')), [1024, 1024]);
assert.equal(eas.build.device.ios.simulator, false);
assert.equal(eas.build.production.autoIncrement, true);
assert.match(metadata, /com\.lodim\.ootique\.plus/);
assert.match(metadata, /IAP 심사용 스크린샷/);
assert.match(policy, /id="privacy"/);
assert.match(policy, /id="support"/);

console.log('release-check: ok');
