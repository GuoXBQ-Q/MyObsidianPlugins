function meta(text,key){const header=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]||'',m=header.match(new RegExp('^'+key+': (.+)$','m'));if(!m)return '';try{return JSON.parse(m[1]);}catch{return m[1].trim();}}
function ideaTitle(body){return Array.from(body.split('\n').find(line=>line.trim())?.replace(/^\s*#{1,6}\s+/,'').trim()||'新的灵感').slice(0,48).join('');}
function ideaFilename(title){
  let name=String(title).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f\[\]^]/g,' ').replace(/\s+/g,' ').replace(/^[. ]+|[. ]+$/g,'');
  if(!name)name='新的灵感';if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))name='灵感-'+name;
  return Array.from(name).slice(0,64).join('').trim().replace(/[. ]+$/,'');
}
function ideaSummary(body){return body.replace(/^#{1,6}\s+/gm,'').replace(/\s+/g,' ').trim();}
function parseIdea(text,path){const body=text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').replace(/^\s*# .+\r?\n/,'').trim();return {path,type:meta(text,'type'),title:meta(text,'title')||path.split('/').pop().replace(/\.md$/,''),created:meta(text,'created'),area:meta(text,'area'),status:meta(text,'status'),body,summary:ideaSummary(body)};}
function createIdeaService(io){
  const queues=new Map();
  return {
    async list(folder){const paths=await io.list(folder);const ideas=await Promise.all(paths.filter(p=>p.endsWith('.md')).map(async p=>parseIdea(await io.read(p),p)));return ideas.filter(idea=>idea.type==='idea').sort((a,b)=>String(b.created).localeCompare(String(a.created)));},
    async capture(folder,{body,area}){
      body=String(body||'').trim();if(!body)throw new Error('先写下一点灵感吧');
      const title=ideaTitle(body),base=ideaFilename(title),now=new Date(),values={type:'idea',title,created:now.toISOString(),status:'inbox',area:area||'未分类'};
      const text='---\n'+Object.entries(values).map(([k,v])=>k+': '+JSON.stringify(v)).join('\n')+'\n---\n\n# '+title+'\n\n'+body+'\n';
      const previous=queues.get(folder)||Promise.resolve(),job=previous.catch(()=>{}).then(async()=>{
        for(let n=1;n<=1000;n++){
          const path=folder+'/'+base+(n===1?'':'（'+n+'）')+'.md';if(await io.exists(path))continue;
          try{await io.create(path,text);return path;}catch(e){if(await io.exists(path))continue;throw e;}
        }
        throw new Error('同名灵感过多，请在正文第一行换一个标题');
      });
      queues.set(folder,job);try{return await job;}finally{if(queues.get(folder)===job)queues.delete(folder);}
    },
    async archive(folder,path,archived){if(!path.startsWith(folder+'/')||path.includes('..')||!path.endsWith('.md'))throw new Error('灵感路径无效');await io.update(path,text=>{if(!/^status: /m.test(text))throw new Error('笔记缺少 status 属性');return text.replace(/^status: .+$/m,'status: '+JSON.stringify(archived?'archived':'inbox'));});}
  };
}
module.exports={parseIdea,createIdeaService,ideaTitle,ideaFilename,ideaSummary};
