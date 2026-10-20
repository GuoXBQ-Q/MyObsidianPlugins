'use strict';

const {REPO, compareVersions, readRelease} = require('./update-format');
const DAY = 24 * 60 * 60 * 1000;
class UpdateController {
  constructor({id, version, appVersion, io, request, unpack, digest, notify = () => {}, now = Date.now, timeout = 30000,
    // Window timer functions cannot be invoked with an UpdateController as their receiver.
    setTimer = (callback, delay) => setTimeout(callback, delay), cancelTimer = timer => clearTimeout(timer)}) {
    Object.assign(this, {id, version, appVersion, io, request, unpack, digest, notify, now, timeout, setTimer, cancelTimer});
    this.state = {autoCheck:true, lastCheck:0, notifiedVersion:''};
    this.installedVersion = version; this.status = '尚未检查'; this.listeners = new Set(); this.alive = true;
    this.busy = true; this.candidate = null; this.latestRelease = null; this.lastSuccess = 0; this.blocked = false;
    this.phase = 'idle'; this.checkError = false; this.savingSettings = false;
    this.pendingRequests = new Set();
  }
  assertActive() { if (!this.alive) throw new Error('插件已卸载，更新已取消'); }
  emit() { if (this.alive) for (const listener of this.listeners) listener(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async initialize(schedule = true) {
    try {
      const {state, installed, recovered} = await this.io.initialize(); this.assertActive();
      if (installed.id !== this.id) throw new Error('本地插件 ID 不匹配');
      compareVersions(installed.version, this.version); this.installedVersion = installed.version;
      if (state) {
        if (state.formatVersion !== 1 || typeof state.autoCheck !== 'boolean' || !Number.isFinite(state.lastCheck) || typeof state.notifiedVersion !== 'string') throw new Error('更新器配置格式不支持');
        this.state = {autoCheck:state.autoCheck, lastCheck:state.lastCheck, notifiedVersion:state.notifiedVersion};
      }
      if (recovered) { this.status = '已恢复中断的更新，请重启 Obsidian'; this.blocked = true; this.phase = 'blocked'; }
      else if (this.pendingRestart) { this.status = '更新已安装，重启后生效'; this.phase = 'installed'; }
      if (schedule) this.schedule(15000, true);
    } catch (e) { this.blocked = true; this.phase = 'blocked'; this.status = '更新功能不可用：' + e.message; }
    this.busy = false; this.emit();
  }
  get pendingRestart() { return this.installedVersion !== this.version; }
  get canInstall() {
    return this.alive && !this.busy && !this.savingSettings && !this.blocked && !this.checkError && !this.pendingRestart &&
      !!this.candidate?.compatible && compareVersions(this.candidate.version, this.installedVersion) > 0;
  }
  async saveState() { await this.io.saveState({formatVersion:1, ...this.state}); }
  async setAutoCheck(value) {
    if (!this.alive || this.busy || this.blocked || this.savingSettings) return;
    const previous = this.state.autoCheck;
    this.savingSettings = true;
    this.state.autoCheck = value;
    this.emit();
    try { await this.saveState(); }
    catch (e) {
      this.state.autoCheck = previous;
      if (this.alive) this.notify('保存更新设置失败：' + e.message);
    }
    this.savingSettings = false;
    this.schedule(15000, value && !previous);
    this.emit();
  }
  schedule(delay, force = false) {
    this.cancelTimer(this.timer);
    if (!this.alive || !this.state.autoCheck || this.blocked || this.pendingRestart) return;
    this.timer = this.setTimer(async () => {
      if (this.state.autoCheck && (force || this.now() - this.state.lastCheck >= DAY)) await this.check(false);
      this.schedule(Math.max(15000, DAY - (this.now() - this.state.lastCheck)));
    }, delay);
  }
  async fetch(url, binary = false) {
    this.assertActive(); let timer, cancel;
    try {
      const response = await Promise.race([
        this.request({url, method:'GET', throw:false, headers:binary ? {} : {Accept:'application/vnd.github+json'}}),
        new Promise((_, reject) => {
          cancel = () => reject(new Error('插件已卸载，更新已取消'));
          this.pendingRequests.add(cancel);
          timer = setTimeout(() => reject(new Error('请求超时，请稍后重试')), this.timeout);
        })
      ]);
      this.assertActive();
      if (response.status === 403 || response.status === 429) throw new Error('GitHub 请求受限，请稍后重试');
      if (response.status !== 200) throw new Error('GitHub 请求失败（HTTP ' + response.status + '）');
      return binary ? response.arrayBuffer : response.json;
    } finally { clearTimeout(timer); this.pendingRequests.delete(cancel); }
  }
  async check(manual = true) {
    if (this.busy || this.savingSettings || this.blocked || !this.alive || this.pendingRestart) return;
    this.busy = true; this.phase = 'checking'; this.status = '正在检查更新…'; this.emit();
    try {
      const release = await this.fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
      this.state.lastCheck = this.now();
      const candidate = readRelease(release, this.id, this.appVersion);
      this.latestRelease = candidate; this.lastSuccess = this.state.lastCheck; this.checkError = false;
      this.candidate = compareVersions(candidate.version, this.installedVersion) > 0 ? candidate : null;
      this.phase = this.candidate ? 'available' : 'latest';
      this.status = this.candidate ? (candidate.compatible ? '发现新版本 ' + candidate.version : '需要 Obsidian ' + candidate.minAppVersion + ' 或更新版本') : '已是最新版本';
      if (this.candidate && candidate.compatible && this.state.notifiedVersion !== candidate.version) {
        this.state.notifiedVersion = candidate.version;
        await this.saveState(); this.assertActive(); this.notify('发现新版本 ' + candidate.version + '，请到插件设置中下载安装');
      } else await this.saveState();
    } catch (e) {
      this.checkError = true; this.phase = 'check-error'; this.status = '检查失败：' + e.message;
      if (this.alive) { this.state.lastCheck = this.now(); try { await this.saveState(); } catch (_) { /* Retain the actionable request error. */ } }
      if (manual && this.alive) this.notify(this.status);
    } finally { this.busy = false; this.emit(); }
  }
  async install() {
    const candidate = this.candidate;
    if (!this.canInstall) return;
    this.busy = true; this.phase = 'installing'; this.status = '正在下载并校验…'; this.emit();
    try {
      const bytes = await this.fetch(candidate.url, true); this.assertActive();
      if (bytes.byteLength !== candidate.size || await this.digest(bytes) !== candidate.digest) throw new Error('下载文件的 SHA-256 或大小校验失败');
      this.assertActive();
      const files = await this.unpack(bytes); this.assertActive();
      const manifest = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(files['manifest.json']));
      if (manifest.id !== this.id || manifest.version !== candidate.version || manifest.minAppVersion !== candidate.minAppVersion) throw new Error('包内 manifest 与发布信息不一致');
      this.status = '正在备份并安装…'; this.emit();
      await this.io.install(files, candidate.version, () => this.assertActive());
      this.installedVersion = candidate.version; this.phase = 'installed'; this.status = '更新已安装，重启后生效';
      this.cancelTimer(this.timer);
      if (this.alive) this.notify(this.status);
    } catch (e) { this.phase = 'install-error'; this.status = '更新失败：' + e.message; if (this.alive) this.notify(this.status); }
    finally { this.busy = false; this.emit(); }
  }
  dispose() {
    this.alive = false; this.cancelTimer(this.timer); this.listeners.clear();
    for (const cancel of this.pendingRequests) cancel(); this.pendingRequests.clear();
  }
}
module.exports = {UpdateController};
