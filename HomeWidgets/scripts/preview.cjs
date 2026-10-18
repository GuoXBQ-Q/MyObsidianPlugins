const http=require('node:http'),fs=require('node:fs/promises'),native=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {vaultPath}=require('../src/adapters/vault');
const ROOT=path.resolve(__dirname,'..'),VAULT=path.resolve(ROOT,'..'),PORT=Number(process.env.HOME_WIDGETS_PORT||4319),ORIGIN='http://127.0.0.1:'+PORT;
const target=p=>path.join(VAULT,vaultPath(p));
const revision=text=>crypto.createHash('sha256').update(text).digest('hex');
const changes=[];let cursor=0;function changed(p){changes.push({cursor:++cursor,path:p});if(changes.length>1000)changes.shift();}
let queue=Promise.resolve();
async function list(folder){const items=await fs.readdir(folder?target(folder):VAULT,{withFileTypes:true});const nested=await Promise.all(items.filter(i=>!i.name.startsWith('.')).map(async item=>{const p=folder?folder+'/'+item.name:item.name;return item.isDirectory()?list(p):item.name.endsWith('.md')?[p]:[];}));return nested.flat();}
async function action(value){const {action,path:p}=value;
  if(action==='changes')return {cursor,paths:changes.filter(c=>c.cursor>(Number(value.cursor)||0)).map(c=>c.path)};
  if(action==='plugin-data-read'||action==='plugin-data-save'){
    const file=path.join(VAULT,'.obsidian/plugins/home-widgets/data.json');let text='';
    try{text=await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(action==='plugin-data-read')return {data:text?JSON.parse(text):null,version:revision(text)};
    if(value.version!==revision(text)){const e=new Error('插件数据已修改，请刷新预览后再试');e.status=409;throw e;}
    if(!value.data||typeof value.data!=='object'||Array.isArray(value.data))throw new Error('插件数据必须为 JSON 对象');
    const next=JSON.stringify(value.data,null,2)+'\n',temp=file+'.hw-tmp';await fs.writeFile(temp,next,'utf8');await fs.rename(temp,file);
    return {version:revision(next)};
  }
  if(action==='notes'){if(typeof p!=='string')throw new Error('请填写笔记目录');return Promise.all((await list(p)).map(async p=>({path:p,ctime:(await fs.stat(target(p))).birthtimeMs})));}
  const file=target(p);
  if(action==='exists'){try{await fs.access(file);return true;}catch{return false;}}
  if(action==='list')return list(p);
  if(!/\.(md|json)$/.test(p))throw new Error('数据接口只接受 Markdown 和 JSON');
  if(action==='read')return fs.readFile(file,'utf8');
  if(action==='snapshot'){const text=await fs.readFile(file,'utf8');return {text,version:revision(text)};}
  if(action==='create'){if(typeof value.text!=='string')throw new Error('内容必须为文本');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value.text,{encoding:'utf8',flag:'wx'});changed(p);return true;}
  if(action==='cas'){const text=await fs.readFile(file,'utf8');if(revision(text)!==value.version){const e=new Error('文件已修改');e.status=409;throw e;}if(typeof value.text!=='string')throw new Error('内容必须为文本');const temp=file+'.hw-tmp';await fs.writeFile(temp,value.text,'utf8');await fs.rename(temp,file);changed(p);return true;}
  throw new Error('未知操作');
}
const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{const send=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(value):value);};try{
  if(req.headers.host!=='127.0.0.1:'+PORT){send(403,{error:'仅允许本机访问'});return;}
  const url=new URL(req.url,ORIGIN);
  if(req.method==='POST'&&url.pathname==='/api/io'){
    if(req.headers.origin!==ORIGIN||req.headers['x-home-widgets']!=='1'){send(403,{error:'请求来源无效'});return;}
    let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>1024*1024)throw new Error('输入过长');}
    const value=JSON.parse(body),job=queue.then(()=>action(value));queue=job.catch(()=>{});send(200,{result:await job});return;
  }
  if(req.method!=='GET'){send(405,{error:'不支持此方法'});return;}
  const staticPaths={'/':['preview.html','text/html'],'/preview.js':['build/preview.js','text/javascript'],'/styles.css':['build/styles.css','text/css'],'/preview-native.css':['preview-native.css','text/css']};
  if(staticPaths[url.pathname]){const [p,type]=staticPaths[url.pathname];send(200,await fs.readFile(path.join(ROOT,p)),type);return;}
  if(url.pathname.startsWith('/asset/')){const p=decodeURIComponent(url.pathname.slice(7)),type=types[path.extname(p).toLowerCase()];if(!type)throw new Error('只支持图片资源');send(200,await fs.readFile(target(p)),type);return;}
  send(404,{error:'未找到'});
}catch(e){send(e.status||(e.code==='ENOENT'?404:400),{error:e.message});}});
const watchers=[];for(const folder of ['Home','Inbox']){const dir=path.join(VAULT,folder);if(native.existsSync(dir)){try{watchers.push(native.watch(dir,{recursive:true},(event,name)=>{const p=folder+'/'+String(name||'').replaceAll('\\','/');if(/\.(md|json)$/.test(p))changed(p);}));}catch{console.warn('External file changes are not watched for '+folder);}}}
server.on('close',()=>watchers.forEach(w=>w.close()));
server.listen(PORT,'127.0.0.1',()=>console.log('Home Widgets preview: '+ORIGIN));
