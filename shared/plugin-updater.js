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
  updater.pluginApp = plugin.app;
  plugin.register(() => updater.dispose());
  updater.ready = updater.initialize();
  return updater;
}

function renderUpdateSettings(parent, updater, obsidian) {
  const {Setting, Modal, setIcon} = obsidian;
  const card = parent.createDiv('plugin-update-card');
  const heading = card.createDiv('plugin-update-heading');
  heading.createEl('h3', {text:'插件更新'});
  const status = heading.createDiv('plugin-update-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const addIcon = (parent, name) => {
    const el = parent.createEl('span', {cls:'plugin-update-icon'});
    el.setAttribute('aria-hidden', 'true'); setIcon(el, name); return el;
  };
  if (!updater) {
    status.textContent = '暂不支持';
    card.createEl('p', {cls:'plugin-update-message', text:'暂不支持在移动端或非本地文件系统中安装更新。'});
    return () => {};
  }
  const statusIcon = addIcon(status, 'circle-help'), statusText = status.createEl('span');
  const versions = card.createDiv('plugin-update-versions');
  const versionCell = (label, icon) => {
    const cell = versions.createDiv('plugin-update-version'); addIcon(cell, icon);
    const info = cell.createDiv('plugin-update-version-info');
    const name = info.createDiv('plugin-update-label'); name.textContent = label;
    const value = info.createDiv('plugin-update-number'); return {name, value};
  };
  const current = versionCell('当前版本', 'hard-drive'), latest = versionCell('最新版本', 'cloud-download');
  current.value.textContent = updater.version;
  const message = card.createEl('p', {cls:'plugin-update-message'});
  const notes = card.createEl('details', {cls:'plugin-update-notes'}); notes.open = true;
  const summary = notes.createEl('summary'); addIcon(summary, 'notebook-text');
  summary.createEl('span', {text:'更新说明'});
  const notesBody = notes.createDiv('plugin-update-notes-body');
  let autoToggle;
  const auto = new Setting(card).setName('自动检查更新').setDesc('启动时检查一次，此后每 24 小时检查一次。仅检测和提示，安装前需要确认。')
    .addToggle(toggle => {
      autoToggle = toggle; toggle.toggleEl.setAttribute('aria-label', '自动检查更新');
      toggle.setValue(updater.state.autoCheck).onChange(value => updater.setAutoCheck(value));
    });
  auto.settingEl.classList.add('plugin-update-auto');
  const footer = card.createDiv('plugin-update-footer');
  const lastCheck = footer.createDiv('plugin-update-last-check');
  const actions = footer.createDiv('plugin-update-actions');
  const button = (parent, text, icon, onClick, primary = false) => {
    const el = parent.createEl('button', {cls:'plugin-update-button' + (primary ? ' is-primary' : '')});
    el.type = 'button'; const glyph = addIcon(el, icon), label = el.createEl('span', {text});
    el.addEventListener('click', onClick); return {el, glyph, label};
  };
  let active = true, confirmation = null, notesVersion = '';
  const checkButton = button(actions, '检查更新', 'refresh-cw', () => updater.check());
  button(actions, '查看 Release', 'external-link', () => {
    const a = parent.ownerDocument.createElement('a');
    a.href = updater.latestRelease?.releaseUrl || `https://github.com/${REPO}/releases/latest`;
    a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
  });
  const installButton = button(actions, '下载并安装', 'download', () => {
    if (!updater.canInstall || confirmation) return;
    const candidate = updater.candidate;
    class InstallConfirmation extends Modal {
      onOpen() {
        this.contentEl.classList.add('plugin-update-confirm');
        this.contentEl.createEl('h2', {text:'确认下载并安装更新'});
        this.contentEl.createEl('p', {text:`将当前版本 ${updater.version} 更新至 ${candidate.version}。`});
        this.contentEl.createEl('p', {text:'确认后将从 GitHub 下载并安装更新，完成后需重启 Obsidian 才会生效。'});
        const controls = this.contentEl.createDiv('plugin-update-actions');
        const cancel = button(controls, '取消', 'x', () => this.close());
        button(controls, '确认安装', 'download', () => {
          this.close();
          // A check or another settings view may have changed the release while this dialog was open.
          if (active && updater.candidate === candidate && updater.canInstall) updater.install();
        }, true);
        cancel.el.focus();
      }
      onClose() { this.contentEl.empty(); confirmation = null; }
    }
    confirmation = new InstallConfirmation(updater.pluginApp); confirmation.open();
  }, true);
  const date = value => new Date(value).toLocaleString('zh-CN', {hour12:false});
  const refresh = () => {
    const checking = updater.phase === 'checking';
    const failed = ['check-error', 'install-error', 'blocked'].includes(updater.phase);
    const pending = updater.pendingRestart;
    let tone = 'neutral', label = '尚未检查', glyph = 'circle-help';
    if (failed) { tone = 'error'; label = updater.phase === 'check-error' ? '检查失败' : updater.phase === 'install-error' ? '安装失败' : '更新不可用'; glyph = 'circle-alert'; }
    else if (pending) { tone = 'info'; label = '待重启生效'; glyph = 'rotate-cw'; }
    else if (checking || updater.busy) { label = checking ? '检查中…' : updater.phase === 'installing' ? '安装中…' : '正在准备…'; glyph = 'loader-circle'; }
    else if (updater.candidate) { tone = 'available'; label = '发现新版本'; glyph = 'circle-arrow-up'; }
    else if (updater.latestRelease) { tone = 'success'; label = '已是最新版本'; glyph = 'circle-check'; }
    status.dataset.tone = tone; statusText.textContent = label; setIcon(statusIcon, glyph);
    statusIcon.classList.toggle('is-spinning', updater.busy);
    card.setAttribute('aria-busy', String(updater.busy));
    current.name.textContent = pending ? '当前运行版本' : '当前版本';
    latest.name.textContent = checking ? '正在获取最新版本…' : updater.checkError && updater.latestRelease ? '最新版本（上次结果）' : '最新版本';
    latest.value.textContent = checking ? '—' : updater.latestRelease?.version || '—';
    let detail = '';
    if (failed) detail = updater.status;
    else if (pending) detail = `更新已安装，重启后生效。已安装 ${updater.installedVersion}，当前仍运行 ${updater.version}。`;
    else if (updater.phase === 'installing' || updater.candidate?.compatible === false) detail = updater.status;
    if (updater.checkError && updater.latestRelease) detail += `；上次成功检查：${date(updater.lastSuccess)}，以上版本信息为上次结果。`;
    message.hidden = !detail; message.textContent = detail; message.dataset.tone = failed ? 'error' : 'info';
    notes.hidden = !updater.candidate || pending || checking;
    if (updater.candidate) {
      if (notesVersion !== updater.candidate.version) { notesVersion = updater.candidate.version; notes.open = true; }
      notesBody.textContent = updater.candidate.notes || '此版本未提供更新说明，可查看 Release 了解详情。';
    }
    lastCheck.textContent = '上次检查：' + (updater.state.lastCheck ? date(updater.state.lastCheck) : '尚未检查');
    checkButton.label.textContent = updater.phase === 'check-error' ? '重试' : checking ? '检查中…' : '检查更新';
    checkButton.glyph.classList.toggle('is-spinning', checking);
    checkButton.el.disabled = updater.busy || updater.savingSettings || updater.blocked || pending;
    installButton.el.disabled = !updater.canInstall;
    installButton.label.textContent = pending ? '已安装，待重启' : updater.phase === 'installing' ? '正在安装…' : '下载并安装';
    autoToggle.setValue(updater.state.autoCheck).setDisabled(updater.busy || updater.savingSettings || updater.blocked);
  };
  const unsubscribe = updater.subscribe(refresh); refresh();
  Promise.resolve(updater.ready).then(() => { if (active) refresh(); });
  return () => { active = false; unsubscribe(); confirmation?.close(); };
}
module.exports = {createPluginUpdater, renderUpdateSettings};
