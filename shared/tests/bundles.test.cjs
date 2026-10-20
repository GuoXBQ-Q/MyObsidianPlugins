const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const {FILES} = require('../update-format');
const {archive, releaseFor} = require('./fixtures.cjs');

class Component {
  constructor() { this.cleanups = []; }
  register(fn) { this.cleanups.push(fn); }
  unload() { this.onunload?.(); for (const fn of this.cleanups.splice(0).reverse()) fn(); }
}
class Plugin extends Component {
  constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; }
  async loadData() { return null; }
  async saveData() { throw new Error('Updates must not write user data'); }
  registerMarkdownCodeBlockProcessor() {} registerEvent() {} addRibbonIcon() {} addCommand() {} registerView() {}
  addSettingTab(tab) { this.tab = tab; }
}
class FileSystemAdapter { constructor(root) { this.root = root; } getBasePath() { return this.root; } }

for (const [project, id, oldVersion] of [['HomeWidgets','home-widgets','0.1.1'],['MyCalendar','my-calendar','1.3.0']]) {
  test(`${project} desktop bundle installs itself and boots the installed version in an isolated vault`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-bundle-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const directory = path.join(root,'.alternative','plugins',id); await fs.mkdir(directory,{recursive:true});
    const files = {};
    for (const name of FILES) files[name] = await fs.readFile(path.resolve(__dirname,'../../',project,'build',name));
    const target = JSON.parse(files['manifest.json']), zip = archive(files), release = releaseFor(id,target.version,target.minAppVersion,zip);
    for (const name of FILES) await fs.writeFile(path.join(directory,name),name === 'manifest.json' ? JSON.stringify({...target,version:oldVersion}) : files[name]);
    await fs.writeFile(path.join(directory,'data.json'),'PRESERVE');
    const obsidian = {Plugin, Component, MarkdownRenderChild:Component, ItemView:Component, Modal:Component, MarkdownView:Component,
      PluginSettingTab:class{}, Notice:class{}, Setting:class{}, MarkdownRenderer:{}, parseYaml:()=>({}),
      Platform:{isDesktopApp:true}, FileSystemAdapter, apiVersion:'1.14.4',
      requestUrl:async params => params.url.endsWith('/releases/latest') ? {status:200,json:release} : {status:200,arrayBuffer:zip}};
    const app = {vault:{adapter:new FileSystemAdapter(root),on:()=>({})},workspace:{},plugins:{plugins:{}}};
    function boot(manifest) {
      const sandbox = {module:{exports:{}}, console, Buffer, TextDecoder, AbortController, crypto,
        setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask, window:{setTimeout,clearTimeout},
        require:name => name === 'obsidian' ? obsidian : require(name)};
      vm.runInNewContext(files['main.js'].toString('utf8'),sandbox);
      const exported = sandbox.module.exports, Entry = project === 'MyCalendar' ? exported.default : exported;
      return new Entry(app,{...manifest,dir:path.relative(root,directory)});
    }
    const plugin = boot({...target,version:oldVersion}); t.after(()=>plugin.unload()); await plugin.onload(); await plugin.updater.ready;
    assert.equal(plugin.updater.blocked,false,plugin.updater.status);
    await plugin.updater.check(); assert.equal(plugin.updater.candidate.version,target.version);
    await plugin.updater.install(); assert(plugin.updater.pendingRestart,plugin.updater.status);
    assert.equal(await fs.readFile(path.join(directory,'data.json'),'utf8'),'PRESERVE');
    for (const name of FILES) assert.deepEqual(await fs.readFile(path.join(directory,name)),files[name]);
    plugin.unload();
    const restarted = boot(JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'))); t.after(()=>restarted.unload());
    await restarted.onload(); await restarted.updater.ready; assert.equal(restarted.updater.pendingRestart,false); assert.equal(restarted.updater.installedVersion,target.version);
  });
  test(`${project} mobile bundle loads without accessing Node modules`, async t => {
    const app = {vault:{on:()=>({})},workspace:{},plugins:{plugins:{}}};
    const obsidian = {Plugin, Component, MarkdownRenderChild:Component, ItemView:Component, Modal:Component, MarkdownView:Component,
      PluginSettingTab:class{}, Notice:class{}, Setting:class{}, MarkdownRenderer:{}, parseYaml:()=>({}), Platform:{isDesktopApp:false}};
    const sandbox = {module:{exports:{}}, console, AbortController, crypto, setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask, window:{setTimeout,clearTimeout},
      require:name=>{assert.equal(name,'obsidian','mobile must not load Node builtins'); return obsidian;}};
    vm.runInNewContext(await fs.readFile(path.resolve(__dirname,'../../',project,'build/main.js'),'utf8'),sandbox);
    const exported = sandbox.module.exports, Entry = project === 'MyCalendar' ? exported.default : exported;
    const plugin = new Entry(app,{id,version:oldVersion}); t.after(()=>plugin.unload()); await plugin.onload(); assert.equal(plugin.updater,null);
  });
}
