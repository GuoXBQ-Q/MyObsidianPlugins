const {Plugin,MarkdownRenderChild,MarkdownRenderer,Component,Notice,parseYaml,Scope}=require('obsidian');
const {Bus}=require('./core/lifecycle');
const {WidgetRegistry}=require('./core/registry');
const {createHost}=require('./core/host');
const {createLayoutStore,DEFAULT_PATH}=require('./services/layout');
const {createServices}=require('./services');
const {createVaultIO}=require('./adapters/vault');
const {createIntegrations}=require('./adapters/integrations');
const {registerBuiltins}=require('./widgets');
const {HomeSettings}=require('./settings');
const {createPluginDataStore}=require('./services/plugin-data');
const {createPersistentEventService}=require('./services/persistent-events');
const {createCalendarDisplayStore}=require('./services/calendar-display');
const {createCalendarAdapter}=require('./adapters/calendar-source');
const {createCountdownService}=require('./services/countdown');
const {assertFields}=require('./core/format');
const {createPluginUpdater}=require('../../shared/plugin-updater');
class HomeRenderChild extends MarkdownRenderChild {
  constructor(el,plugin,path,sourcePath){super(el);this.plugin=plugin;this.path=path;this.sourcePath=sourcePath;}
  onload(){let unloaded=false;this.plugin.renders.add(this);this.register(()=>{unloaded=true;this.host?.dispose();this.plugin.renders.delete(this);});
    const store=createLayoutStore(this.plugin.io,this.plugin.bus,this.plugin.registry);
    this.ready=store.initialize().then(async()=>{if(unloaded)return;this.host=createHost(this.containerEl,{registry:this.plugin.registry,store,services:this.plugin.services,platform:{vaultId:this.plugin.app.vault.getName(),preview:false},sourcePath:this.sourcePath});await this.host.ready;if(this.plugin.pendingWidget)await this.host.locate(this.plugin.pendingWidget);}).catch(e=>{if(!unloaded)this.containerEl.createEl('p',{text:'Home Widgets：'+e.message});});
  }
}
class HomeWidgetsPlugin extends Plugin {
  async onload(){
    this.dataStore=createPluginDataStore({load:()=>this.loadData(),save:data=>this.saveData(data)});
    const saved=await this.dataStore.read();this.settings={homeFile:saved.homeFile||'homepage.md'};this.bus=new Bus();this.registry=new WidgetRegistry();registerBuiltins(this.registry);this.renders=new Set();this.register(()=>{for(const render of [...this.renders])render.unload();this.renders.clear();});
    this.io=createVaultIO(this.app,this.bus);this.integrations=createIntegrations(this.app,{Component,MarkdownRenderer,Scope});
    this.calendar=createCalendarAdapter({display:createCalendarDisplayStore(this.dataStore),bus:this.bus,resolve:()=>{
      const manager=this.app.plugins;if(manager?.enabledPlugins&&!manager.enabledPlugins.has('my-calendar'))return null;
      const plugin=manager?.plugins?.['my-calendar'];return plugin?.countdownSource?{source:plugin.countdownSource,widget:plugin.homeWidget}:null;
    },registerWidget:definition=>this.api.registerWidget(definition,{pluginId:'my-calendar',pluginName:'MyCalendar'})});
    this.register(()=>this.calendar.dispose());
    this.services=createServices(this.io,this.bus,this.integrations,createCountdownService(createPersistentEventService(this.dataStore,this.bus),this.calendar));
    this.updater=createPluginUpdater(this,require('obsidian'));
    this.registerMarkdownCodeBlockProcessor('home-widgets',(source,el,ctx)=>{
      let settings;try{settings=source.trim()?parseYaml(source):{};if(settings===null)settings={};assertFields(settings,['layout','focus'],'首页代码块');if(settings.layout!==undefined&&settings.layout!==DEFAULT_PATH)throw new Error('只支持唯一首页布局：'+DEFAULT_PATH);if(settings.focus!==undefined&&(typeof settings.focus!=='string'||!settings.focus.trim()))throw new Error('focus 应填写首页组件 ID');}
      catch(e){el.createEl('p',{text:'Home Widgets 配置错误：'+e.message});return;}
      if(settings.focus){const button=el.createEl('button',{text:settings.focus==='ideas'?'打开灵感收件箱':'打开首页并定位组件'});button.addEventListener('click',()=>this.openWidget(settings.focus).catch(error=>new Notice(error.message)));return;}
      ctx.addChild(new HomeRenderChild(el,this,DEFAULT_PATH,ctx.sourcePath));
    });
    for(const event of ['modify','create','delete'])this.registerEvent(this.app.vault.on(event,file=>{if(file?.path)this.bus.changed(file.path);}));
    this.registerEvent(this.app.vault.on('rename',(file,old)=>{this.bus.changed(old);this.bus.changed(file.path);}));
    const open=()=>this.app.workspace.openLinkText(this.settings.homeFile,'',false);
    this.addRibbonIcon('house','Home Widgets',open);
    this.addCommand({id:'open-home',name:'打开首页',callback:open});
    this.addCommand({id:'refresh-integrations',name:'重新检测基础插件',callback:()=>{this.bus.emit('integrations');new Notice('Home Widgets：已重新检测基础插件');}});
    const settingsTab=new HomeSettings(this.app,this);
    this.addSettingTab(settingsTab);this.register(()=>settingsTab.hide());
    // Public extension API: returns an unregister function. Keep ownership with the caller.
    this.api={version:3,registerWidget:(definition,source)=>{
      assertFields(source,['pluginId','pluginName'],'组件来源');
      if(typeof source.pluginId!=='string'||!source.pluginId.trim()||typeof source.pluginName!=='string'||!source.pluginName.trim())throw new Error('注册组件必须提供 pluginId 和 pluginName');
      const unregister=this.registry.register(definition,{pluginId:source.pluginId,pluginName:source.pluginName,kind:'external'});this.bus.emit('registry');return ()=>{unregister();this.bus.emit('registry');};
    },listWidgetTypes:()=>this.registry.list().map(d=>({type:d.type,label:d.label,supportsMultipleInstances:d.supportsMultipleInstances===true})),registerActivitySource:definition=>this.services.activity.registerSource(definition)};
    this.calendar.start();
  }
  saveSettings(){return this.dataStore.update(data=>({...data,homeFile:this.settings.homeFile}));}
  async openWidget(id){
    const store=createLayoutStore(this.io,this.bus,this.registry),layout=await store.load(),item=layout.widgets.find(item=>item.id===id);
    if(!item)throw new Error('首页中找不到组件：'+id);
    if(item.hidden)await store.patchWidget(id,{hidden:false});
    this.pendingWidget=id;await this.app.workspace.openLinkText(this.settings.homeFile,'',false);
    for(const render of this.renders){await render.ready;await render.host?.locate(id);}
  }
}
module.exports=HomeWidgetsPlugin;
