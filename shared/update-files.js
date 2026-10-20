'use strict';

const {FILES, compareVersions} = require('./update-format');
// This module loads Node builtins only when the desktop adapter is constructed.
function createFileInstaller(directory, fsOverride) {
  const fs = fsOverride || require('node:fs/promises'), path = require('node:path');
  const root = path.join(directory, '.github-updater'), backup = path.join(root, 'backup'), stage = path.join(root, 'stage');
  const journalPath = path.join(root, 'transaction.json'), statePath = path.join(root, 'state.json');
  // Survive disable/re-enable while asynchronous installation is still rolling back.
  const lockKey = Symbol.for('my-obsidian-plugins.update-locks');
  const locks = globalThis[lockKey] || (globalThis[lockKey] = new Map());
  function exclusive(action) {
    const next = (locks.get(directory) || Promise.resolve()).catch(() => {}).then(action);
    locks.set(directory, next);
    const release = () => { if (locks.get(directory) === next) locks.delete(directory); };
    next.then(release, release); return next;
  }
  async function atomic(file, bytes) { await fs.writeFile(file + '.tmp', bytes); await fs.rename(file + '.tmp', file); }
  async function json(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  function validateJournal(journal) {
    if (journal.formatVersion !== 1 || !['prepared', 'installing', 'committed', 'rolled-back'].includes(journal.phase)) throw new Error('更新事务格式异常，请根据备份说明恢复');
  }
  async function rollback(journal) {
    validateJournal(journal);
    // Read all originals before restoring any file. Keep the journal on any failure.
    const originals = await Promise.all(FILES.map(name => fs.readFile(path.join(backup, name))));
    for (let i = 0; i < FILES.length; i++) await atomic(path.join(directory, FILES[i]), originals[i]);
    await atomic(journalPath, JSON.stringify({...journal, phase: 'rolled-back'}));
  }
  return {
    initialize() { return exclusive(async () => {
      await fs.mkdir(root, {recursive:true});
      const journal = await json(journalPath);
      if (journal) validateJournal(journal);
      if (journal && !['committed', 'rolled-back'].includes(journal.phase)) await rollback(journal);
      const installed = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
      return {state: await json(statePath), installed, recovered: !!journal && !['committed', 'rolled-back'].includes(journal.phase)};
    }); },
    saveState(state) {
      return exclusive(() => atomic(statePath, JSON.stringify(state, null, 2)));
    },
    install(files, version, assertActive) { return exclusive(async () => {
      assertActive();
      const current = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
      if (current.id !== JSON.parse(files['manifest.json'].toString('utf8')).id || compareVersions(version, current.version) <= 0) throw new Error('本地版本已变化，请重启并重新检查更新');
      const prior = await json(journalPath);
      if (prior) validateJournal(prior);
      if (prior && !['committed', 'rolled-back'].includes(prior.phase)) throw new Error('上次更新尚未恢复，请重启后再试');
      // Remove the previous completed journal before replacing its backups.
      await fs.rm(journalPath, {force:true});
      await fs.mkdir(backup, {recursive:true}); await fs.mkdir(stage, {recursive:true});
      for (const name of FILES) {
        assertActive();
        await fs.copyFile(path.join(directory, name), path.join(backup, name));
        await fs.writeFile(path.join(stage, name), files[name]);
      }
      await fs.writeFile(path.join(root, '恢复说明.txt'), '关闭 Obsidian，将 backup 中的 main.js、manifest.json、styles.css 复制回上一级插件目录，再删除 transaction.json。保留 data.json。\n');
      const journal = {formatVersion:1, phase:'prepared', version};
      await atomic(journalPath, JSON.stringify(journal));
      try {
        assertActive(); await atomic(journalPath, JSON.stringify({...journal, phase:'installing'}));
        for (const name of FILES) { assertActive(); await fs.rename(path.join(stage, name), path.join(directory, name)); }
        assertActive(); await atomic(journalPath, JSON.stringify({...journal, phase:'committed'}));
      } catch (e) {
        try { await rollback(journal); } catch (restoreError) { throw new Error('安装失败且自动恢复未完成，请关闭 Obsidian 并按备份说明恢复：' + restoreError.message); }
        throw new Error('安装未完成，已恢复旧版本：' + e.message);
      }
    }); }
  };
}
module.exports = {createFileInstaller};
