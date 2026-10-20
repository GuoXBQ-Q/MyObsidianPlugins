'use strict';

const REPO = 'GuoXBQ-Q/MyObsidianPlugins';
const FILES = ['main.js', 'manifest.json', 'styles.css'];
const START = '<!-- obsidian-plugin-updates:v1 -->';
const END = '<!-- /obsidian-plugin-updates -->';
function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('版本号必须为 x.y.z');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('版本号超出支持范围');
  return parts;
}
function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function readRelease(release, id, appVersion) {
  if (release.draft || release.prerelease || !/^plugins-\d+\.\d+\.\d+$/.test(release.tag_name || '')) throw new Error('没有可用的正式发布版本');
  const body = release.body || '', start = body.indexOf(START), end = body.indexOf(END);
  if (start < 0 || end < start) throw new Error('此历史 Release 不支持插件内更新，请查看发布页面');
  const metadata = JSON.parse(body.slice(start + START.length, end).trim().replace(/^```json\s*|\s*```$/g, ''));
  if (metadata.formatVersion !== 1 || !Array.isArray(metadata.plugins)) throw new Error('不支持的更新元数据格式');
  const matches = metadata.plugins.filter(p => p.id === id);
  if (matches.length !== 1) throw new Error('发布元数据缺少插件或插件重复');
  const plugin = matches[0];
  versionParts(plugin.version); versionParts(plugin.minAppVersion);
  if (plugin.asset !== id + '.zip') throw new Error('更新附件名称不匹配');
  const assets = (release.assets || []).filter(a => a.name === plugin.asset && a.state === 'uploaded');
  if (assets.length !== 1) throw new Error('更新附件尚未就绪或重复');
  const asset = assets[0];
  const expected = `https://github.com/${REPO}/releases/download/${release.tag_name}/${plugin.asset}`;
  if (asset.browser_download_url !== expected) throw new Error('更新附件地址不匹配');
  if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')) throw new Error('更新附件缺少 SHA-256 校验信息');
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 32 * 1024 * 1024) throw new Error('更新附件大小异常');
  const notes = (body.slice(0, start) + body.slice(end + END.length)).trim();
  return {...plugin, notes, url: expected, digest: asset.digest.slice(7).toLowerCase(), size: asset.size,
    releaseUrl: `https://github.com/${REPO}/releases/tag/${release.tag_name}`,
    compatible: compareVersions(appVersion, plugin.minAppVersion) >= 0};
}
module.exports = {REPO, FILES, START, END, versionParts, compareVersions, readRelease};
