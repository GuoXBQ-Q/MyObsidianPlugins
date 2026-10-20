'use strict';

const fs = require('node:fs/promises'), path = require('node:path'), {inflateRawSync} = require('node:zlib');
const {REPO, FILES, compareVersions} = require('../shared/update-format');
const {unpackZip} = require('../shared/update-zip');

function validateUpgrade(previous, current, id) {
  const before = JSON.parse(previous['manifest.json']), after = JSON.parse(current['manifest.json']);
  if (before.id !== id || after.id !== id) throw new Error('Plugin ID mismatch: ' + id);
  const comparison = compareVersions(after.version, before.version);
  if (comparison < 0) throw new Error('Plugin version must not decrease: ' + id);
  const changed = FILES.some(name => !Buffer.from(previous[name]).equals(Buffer.from(current[name])));
  if (changed && comparison === 0) throw new Error(`Runtime files changed without a version increase: ${id} ${after.version}`);
}
async function checkRelease(directory) {
  const headers = {Accept:'application/vnd.github+json'};
  if (process.env.GH_TOKEN) headers.Authorization = 'Bearer ' + process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {headers, signal:AbortSignal.timeout(30000)});
  if (response.status === 404) { console.log('No previous release; initial publication.'); return; }
  if (!response.ok) throw new Error('Cannot check previous release: HTTP ' + response.status);
  const release = await response.json();
  if (release.draft || release.prerelease) throw new Error('Expected a stable published release');
  for (const id of ['home-widgets', 'my-calendar']) {
    const assets = release.assets.filter(asset => asset.name === id + '.zip');
    if (assets.length !== 1) throw new Error('Previous release asset missing or repeated: ' + id);
    const url = new URL(assets[0].browser_download_url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/' + REPO + '/releases/download/')) throw new Error('Unexpected asset URL');
    // Never forward the API token to a download URL or its redirect destination.
    const download = await fetch(url, {signal:AbortSignal.timeout(60000)});
    if (!download.ok) throw new Error('Cannot download previous plugin: HTTP ' + download.status);
    const previous = unpackZip(await download.arrayBuffer(), inflateRawSync);
    const current = unpackZip(await fs.readFile(path.join(directory, id + '.zip')), inflateRawSync);
    validateUpgrade(previous, current, id);
    console.log('Version checked: ' + id);
  }
}
if (require.main === module) checkRelease(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {validateUpgrade};
