function vaultPath(path){if(typeof path!=='string'||!path.trim()||path.includes('\\')||path.startsWith('/')||path.includes(':')||path.split('/').some(p=>p==='..'||p==='.'||!p||p.startsWith('.')))throw new Error('请使用知识库内的普通相对路径');return path;}
function createVaultIO(app,bus) {
  const queues=new Map();
  async function folder(path){const parts=path.split('/');parts.pop();let prefix='';for(const part of parts){prefix=prefix?prefix+'/'+part:part;if(!await app.vault.adapter.exists(prefix)){try{await app.vault.createFolder(prefix);}catch(e){if(!await app.vault.adapter.exists(prefix))throw e;}}}}
  const io={
    read:path=>app.vault.adapter.read(vaultPath(path)),
    exists:path=>app.vault.adapter.exists(vaultPath(path)),
    async create(path,text){vaultPath(path);await folder(path);await app.vault.create(path,text);bus.changed(path);},
    async update(path,fn){vaultPath(path);const previous=queues.get(path)||Promise.resolve();const next=previous.catch(()=>{}).then(async()=>{const file=app.vault.getAbstractFileByPath(path);if(!file)throw new Error('找不到笔记：'+path);await app.vault.process(file,fn);bus.changed(path);});queues.set(path,next);try{await next;}finally{if(queues.get(path)===next)queues.delete(path);}},
    list:async folder=>{vaultPath(folder);return app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(folder+'/')).map(f=>f.path);},
    notes:async(folder='')=>{if(folder)vaultPath(folder);return app.vault.getMarkdownFiles().filter(f=>!folder||f.path.startsWith(folder+'/')).map(f=>({path:f.path,ctime:f.stat.ctime}));},
    resource:path=>app.vault.adapter.getResourcePath(vaultPath(path)),
    open:path=>app.workspace.openLinkText(vaultPath(path),'homepage.md',false)
  };
  return io;
}
module.exports={vaultPath,createVaultIO};
