'use strict';

const {UpdateController} = require('./update-controller');
const {createFileInstaller} = require('./update-files');
const {unpackZip} = require('./update-zip');
const {REPO} = require('./update-format');

function createPluginUpdater(plugin, obsidian) {
  if (!obsidian.Platform?.isDesktopApp) return null;
  const {join, resolve, relative, isAbsolute, sep} = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
  const adapter = plugin.app.vault.adapter;
  if (!(adapter instanceof obsidian.FileSystemAdapter) || !plugin.manifest.dir) return null;
  const base = resolve(adapter.getBasePath()), directory = resolve(join(base, plugin.manifest.dir));
  const inside = relative(base, directory);
  if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new Error('插件安装路径不在当前 Vault 中');
  const updater = new UpdateController({
    id:plugin.manifest.id, version:plugin.manifest.version, appVersion:obsidian.apiVersion,
    io:createFileInstaller(directory), request:params => obsidian.requestUrl(params),
    unpack:bytes => unpackZip(bytes, zlib.inflateRawSync),
    digest:bytes => crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    notify:message => new obsidian.Notice(plugin.manifest.name + '：' + message)
  });
  plugin.register(() => updater.dispose());
  updater.ready = updater.initialize();
  return updater;
}

function renderUpdateSettings(parent, updater, obsidian) {
  const {Setting} = obsidian;
  parent.createEl('h3', {text:'插件更新'});
  if (!updater) { parent.createEl('p', {text:'暂不支持在移动端或非本地文件系统中安装更新。'}); return () => {}; }
  const versions = parent.createEl('p'), status = parent.createEl('p');
  let checkButton, installButton, autoToggle;
  new Setting(parent).setName('自动检查更新').setDesc('启动后检查，此后每 24 小时检查一次；安装前需点击确认。')
    .addToggle(toggle => { autoToggle = toggle; toggle.setValue(updater.state.autoCheck).onChange(value => updater.setAutoCheck(value)); });
  const actions = new Setting(parent).setName('GitHub Release')
    .addButton(button => { checkButton = button; button.setButtonText('立即检查').onClick(() => updater.check()); })
    .addButton(button => button.setButtonText('查看 Release').onClick(() => {
      const url = updater.candidate?.releaseUrl || `https://github.com/${REPO}/releases/latest`;
      const a = parent.ownerDocument.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
    }))
    .addButton(button => { installButton = button; button.setButtonText('下载并安装').onClick(() => updater.install()); });
  actions.controlEl.style.flexWrap = 'wrap';
  const refresh = () => {
    versions.textContent = `当前运行：${updater.version}　已安装：${updater.installedVersion}　可用版本：${updater.candidate?.version || '—'}`;
    status.textContent = `${updater.status}；最近检查：${updater.state.lastCheck ? new Date(updater.state.lastCheck).toLocaleString() : '尚未检查'}`;
    checkButton.setDisabled(updater.busy || updater.blocked || updater.pendingRestart);
    installButton.setDisabled(updater.busy || updater.blocked || updater.pendingRestart || !updater.candidate?.compatible);
    autoToggle.setValue(updater.state.autoCheck).setDisabled(updater.busy || updater.blocked);
  };
  let active = true;
  const unsubscribe = updater.subscribe(refresh); refresh();
  Promise.resolve(updater.ready).then(() => { if (active) refresh(); });
  return () => { active = false; unsubscribe(); };
}
module.exports = {createPluginUpdater, renderUpdateSettings};
