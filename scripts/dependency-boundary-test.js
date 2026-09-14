#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Run through each real Metro caller's installed graph, not a substitute parser.
const roots = ['metro', '@expo/metro', '@react-native/community-cli-plugin'];
for (const root of roots) {
  const caller = path.dirname(require.resolve(`${root}/package.json`));
  const metro = root === 'metro' ? require.resolve('metro/package.json')
    : require.resolve('metro/package.json', { paths: [caller] });
  const assets = path.join(path.dirname(metro), 'src/Assets.js');
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { getAssetSize } = require(${JSON.stringify(assets)});
    for (const size of [0, 4]) {
      const bad = Buffer.alloc(16);
      bad.write('icns'); bad.writeUInt32BE(16, 4);
      bad.write('ic07', 8); bad.writeUInt32BE(size, 12);
      for (const extension of ['png', 'jpg', 'svg']) {
        assert.throws(() => getAssetSize(extension, bad, 'untrusted.' + extension));
      }
    }
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx0AAAAASUVORK5CYII=', 'base64');
    assert.deepEqual(getAssetSize('png', png, 'valid.png'), { width: 1, height: 1 });
    assert.equal(getAssetSize('pdf', png, 'document.pdf'), null);
  `], { encoding: 'utf8', timeout: 2000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${root}: ${result.stderr}`);
}

// Both existing plist callers must keep working across their separate XML versions.
const xml = '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>192</string><key>Enabled</key><true/></dict></plist>';
for (const name of ['@expo/plist', 'plist']) {
  const module = require(name);
  const parser = name === '@expo/plist' ? module.default : module;
  const parsed = parser.parse(xml);
  assert.deepEqual({ ...parsed }, { CFBundleVersion: '192', Enabled: true });
}
const yaml = require('js-yaml');
assert.deepEqual(yaml.safeLoad('reporter:\n  - text\nall: true\n'), { reporter: ['text'], all: true });
assert.ok(require('browserslist')('defaults').length > 0);
console.log('Dependency boundary checks PASS: malformed image termination, valid assets, plist, YAML, browser configuration.');
