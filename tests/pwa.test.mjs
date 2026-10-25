import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>readFileSync(resolve(root,name));

test('PWA install icons are real PNGs at both declared resolutions',()=>{
  const manifest=JSON.parse(read('manifest.json').toString());
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('icons/'));
    const png=read(icon.src);
    assert.ok(png.byteLength>100,icon.src+' must not be an empty placeholder');
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const expected=Number(icon.sizes.split('x')[0]);
    assert.equal(png.readUInt32BE(16),expected);
    assert.equal(png.readUInt32BE(20),expected);
  }
});

test('runtime procedural grass needs no external texture CDN',()=>{
  const source=read('js/components/terrain.js').toString();
  assert.ok(source.includes("new BABYLON.DynamicTexture('local-grass'"));
  assert.ok(!source.includes('https://assets.babylonjs.com/textures/grass.png'));
});

test('PWA core asset list includes every imported game system',()=>{
  const cache=read('sw.js').toString();
  const game=read('js/game.js').toString();
  const imports=[...game.matchAll(/from '\.\/components\/([^']+)'/g)]
    .map(match=>"'./js/components/"+match[1]+"'");
  for(const script of imports)assert.ok(cache.includes(script),script+' is not precached');
  for(const png of ['icon-192x192.png','icon-512x512.png'])
    assert.ok(cache.includes(png));
  assert.ok(cache.includes("cache.add(REMOTE_ENGINE)"),'cache the online engine when possible');
});
