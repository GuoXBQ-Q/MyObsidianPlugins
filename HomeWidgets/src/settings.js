const {PluginSettingTab,Setting,Notice}=require('obsidian');
const {createLayoutStore}=require('./services/layout');
const {createForms}=require('./core/forms');
const {configureFields,configureInitial,configurePatch}=require('./core/schema');
const {widgetIcon,icon}=require('./core/icons');
const {showNewWidget,confirmRemoveWidget}=require('./core/widget-instances');
const {FONT_OPTIONS,applyTypography}=require('./core/typography');
const {renderUpdateSettings}=require('../../shared/plugin-updater');

function group(parent,title,description){
  const section=parent.createDiv('hw-set-group');
  const heading=section.createDiv('hw-set-group-heading');
  heading.createEl('h3',{text:title});
  if(description)heading.createEl('p',{text:description});
  return section.createDiv('hw-set-group-body');
}

class HomeSettings extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    try{this.displayInner();}
    catch(e){console.error('Home Widgets 设置页加载失败',e);this.containerEl.createEl('p',{cls:'hw-set-error',text:'设置页加载出错：'+e.message});}
  }
  displayInner(){
    this.disposeView();
    const {containerEl}=this;containerEl.empty();
    const view=this.view={active:true},store=this.store=createLayoutStore(this.plugin.io,this.plugin.bus);
    const root=containerEl.createDiv('hw-settings');
    const heading=root.createDiv('hw-set-heading');
    heading.createEl('h2',{text:'Home Widgets'});
    heading.createEl('p',{text:'让每个组件，都有自己的位置。'});
    const tabs=root.createDiv('hw-set-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','设置分类');
    const panels=new Map(),buttons=new Map();
    let selected='general',layout,width,loadError='';
    const activeTypes={builtin:null,external:null};
    for(const [key,label] of [['general','通用'],['builtin','内置组件'],['external','外部插件']]){
      const button=tabs.createEl('button',{cls:'hw-set-tab',text:label});button.type='button';
      const panel=root.createDiv('hw-set-panel');
      button.setAttribute('role','tab');button.setAttribute('aria-controls','hw-settings-'+key);button.id='hw-settings-tab-'+key;
      panel.id='hw-settings-'+key;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
      buttons.set(key,button);panels.set(key,panel);
      button.addEventListener('click',()=>selectTab(key));
    }
    const selectTab=key=>{
      selected=key;
      for(const [id,button] of buttons){const active=id===key;button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));panels.get(id).hidden=!active;}
      if(key!=='general')renderComponents();
    };
    const general=panels.get('general');
    this.disposeUpdater=renderUpdateSettings(general,this.plugin.updater,require('obsidian'));
    const home=group(general,'首页与布局','选择首页笔记，调整组件的显示范围。');
    new Setting(home).setName('首页笔记').setDesc('搭配 Homepage 插件，可在启动时自动打开。').addText(text=>text.setValue(this.plugin.settings.homeFile).onChange(value=>{this.plugin.settings.homeFile=value;this.run(this.plugin.saveSettings());}));
    new Setting(home).setName('页面最大宽度').setDesc('选择跟随窗口，或设置固定宽度。').addDropdown(dd=>{
      dd.selectEl.setAttribute('aria-label','页面最大宽度');
      dd.addOption('','默认（1440px）');dd.addOption('full','跟随窗口宽度');dd.addOption('1600','固定 1600px');dd.addOption('1920','固定 1920px');dd.addOption('2560','固定 2560px');
      width=dd;dd.setDisabled(true);dd.onChange(v=>this.run(store.page({maxWidth:v===''?undefined:v==='full'?'full':Number(v)})));
    });
    const typography=group(general,'字体与排版','仅调整首页组件，不影响普通笔记。更改后自动保存。');
    let fontControl,sizeControl,lineControl,customControl,resetControl;
    new Setting(typography).setName('首页字体').setDesc('默认使用 Noto Sans SC，也可跟随 Obsidian 或指定字体。').addDropdown(dd=>{
      fontControl=dd;dd.selectEl.setAttribute('aria-label','首页字体');
      for(const [value,label] of FONT_OPTIONS)dd.addOption(value,label);
      dd.setDisabled(true);dd.onChange(value=>this.run(store.typography({font:value})));
    });
    const customRow=new Setting(typography).setName('自定义字体名称').setDesc('填写已安装的字体名称，离开输入框后保存。留空使用默认字体。').addText(text=>{
      customControl=text;text.setPlaceholder('例如：Microsoft YaHei').setDisabled(true);text.inputEl.setAttribute('aria-label','自定义字体名称');
      text.inputEl.addEventListener('change',()=>this.run(store.typography({customFont:text.getValue().trim()})));
    });customRow.settingEl.hidden=true;
    new Setting(typography).setName('正文字号').setDesc('标题和辅助文字会按比例调整，工具按钮保持紧凑。').addDropdown(dd=>{
      sizeControl=dd;dd.selectEl.setAttribute('aria-label','正文字号');
      for(let size=12;size<=24;size++)dd.addOption(String(size),size+'px');
      dd.setDisabled(true);dd.onChange(value=>this.run(store.typography({fontSize:Number(value)})));
    });
    const lineOptions=new Set(['1.2','1.3','1.4','1.5','1.6','1.7','1.75','1.8','1.9','2','2.2','2.4']);
    new Setting(typography).setName('正文行距').setDesc('数值越大，文字之间越舒展。').addDropdown(dd=>{
      lineControl=dd;dd.selectEl.setAttribute('aria-label','正文行距');
      for(const value of lineOptions)dd.addOption(value,value+' 倍');
      dd.setDisabled(true);dd.onChange(value=>this.run(store.typography({lineHeight:Number(value)})));
    });
    new Setting(typography).setName('恢复默认').setDesc('Noto Sans SC · 15px · 1.75 倍行距').addButton(button=>{
      resetControl=button;button.setButtonText('恢复默认排版').setDisabled(true).onClick(()=>this.run(store.page({typography:undefined})));
    });
    const fontPreview=typography.createDiv('hw-font-preview');fontPreview.textContent='把想做的事，一点一点变成现实。\nHome Widgets · 0123456789';
    const integrations=group(general,'可选集成','为内置组件提供查询、任务和快捷采集能力。');
    const renderIntegrations=()=>{
      integrations.empty();const status=this.plugin.integrations.status();
      for(const [id,name,description] of [['dataview','Dataview','为 Dataview 查询组件提供笔记查询。'],['tasks','Tasks','为 Tasks 查询组件与周期任务提供支持。'],['quickadd','QuickAdd','为速记和命令组件提供快捷流程。']]){
        const row=integrations.createDiv('hw-set-integration');
        const info=row.createDiv('hw-set-info');info.createEl('div',{cls:'hw-set-name',text:name});info.createEl('div',{cls:'hw-set-desc',text:description});
        row.createEl('span',{cls:'hw-set-status'+(status[id]?' is-connected':''),text:status[id]?'已连接':'未启用'});
      }
    };
    renderIntegrations();
    const more=group(general,'更多');
    new Setting(more).setName('布局文件').setDesc('打开当前首页的布局配置。').addButton(b=>b.setButtonText('打开布局').onClick(()=>this.app.workspace.openLinkText(store.path,'',false)));
    new Setting(more).setName('使用指南').setDesc('了解组件配置与插件扩展。').addButton(b=>b.setButtonText('打开指南').onClick(()=>this.app.workspace.openLinkText('HomeWidgets/README.md','',false)));
    const error=root.createEl('p',{cls:'hw-set-error'});error.setAttribute('role','alert');

    const renderComponents=()=>{
      const panel=panels.get(selected);panel.empty();
      if(!layout){panel.createEl('p',{cls:'hw-set-empty',text:loadError?'布局暂不可用，请重新打开设置页。':'正在读取组件…'});return;}
      const external=selected==='external';
      panel.createEl('p',{cls:'hw-set-note hw-set-intro',text:external?'由其他插件提供的组件。对应插件启用并连接后，即可在首页使用。':'Home Widgets 自带的组件。每个实例可单独配置和显示。'});
      const definitions=this.plugin.registry.list().filter(def=>(this.plugin.registry.source(def.type)?.kind==='external')===external);
      // An unavailable extension still owns saved instances; keep them reachable.
      if(external)for(const item of layout.widgets)if(!this.plugin.registry.get(item.type)&&!definitions.some(def=>def.type===item.type))definitions.push({type:item.type,label:item.type,unavailable:true});
      if(!definitions.length){
        const empty=group(panel,'暂无外部插件组件');
        empty.createEl('p',{cls:'hw-set-empty',text:'启用支持 Home Widgets 的插件后，组件会自动出现在这里。'});return;
      }
      if(!definitions.some(def=>def.type===activeTypes[selected]))activeTypes[selected]=definitions[0].type;
      const subtabs=panel.createDiv('hw-set-subtabs');subtabs.setAttribute('role','tablist');subtabs.setAttribute('aria-label','组件类型');
      for(const def of definitions){
        const active=def.type===activeTypes[selected];
        const button=subtabs.createEl('button',{cls:'hw-set-subtab'+(active?' is-active':''),text:def.label});button.type='button';
        button.setAttribute('role','tab');button.setAttribute('aria-selected',String(active));
        button.addEventListener('click',()=>{activeTypes[selected]=def.type;renderComponents();});
      }
      const def=definitions.find(def=>def.type===activeTypes[selected]);
      const items=layout.widgets.filter(item=>item.type===def.type),source=this.plugin.registry.source(def.type);
      const summary=panel.createDiv('hw-set-summary');
      const icon=summary.createDiv('hw-set-icon');icon.append(widgetIcon(panel.ownerDocument,def));icon.setAttribute('aria-hidden','true');
      const info=summary.createDiv('hw-set-info'),title=info.createDiv('hw-set-titleline');
      title.createEl('span',{cls:'hw-set-name',text:def.label});title.createEl('span',{cls:'hw-set-badge',text:external?'插件扩展':'内置'});
      info.createEl('div',{cls:'hw-set-desc',text:(source?.pluginName?source.pluginName+' · ':'')+items.length+' 个实例 · '+items.filter(item=>!item.hidden).length+' 个显示中'});
      summary.createEl('span',{cls:'hw-set-status'+(!def.unavailable?' is-connected':''),text:def.unavailable?'未连接':external?'已连接':'已就绪'});
      if(def.unavailable)panel.createEl('p',{cls:'hw-set-warning',text:'该组件的插件尚未连接。已有配置已保留；连接后可继续编辑组件专属设置。'});
      const dependency={dataview:['dataview','Dataview'],'tasks-query':['tasks','Tasks']}[def.type];
      if(dependency&&!this.plugin.integrations.status()[dependency[0]])panel.createEl('p',{cls:'hw-set-warning',text:'此组件由 Home Widgets 内置，使用时需要启用 '+dependency[1]+' 插件。'});
      if(!def.unavailable){
        const add=panel.createEl('button',{cls:'hw-set-add',text:'＋ 新增实例'});add.type='button';add.setAttribute('aria-label','新增实例 '+def.label);
        add.addEventListener('click',()=>{if(view.active)showNewWidget(this.getForms(),this.plugin.registry,store,def.type);});
      }
      const cards=group(panel,'组件实例','点击卡片编辑设置；开关控制显示，垃圾桶删除实例。删除待办组件时可选择保留任务转为未分类，或同时删除该分类任务。');cards.classList.toggle('hw-set-cards',true);
      if(!items.length)cards.createEl('p',{cls:'hw-set-empty',text:def.unavailable?'此类型没有已保存的实例。':'还没有此类型的实例。点击「＋ 新增实例」从默认配置创建。'});
      for(const item of items)cards.append(this.instanceCard(def,item,store));
      if(def.fields?.length){
        const fields=group(panel,'可配置项');fields.createEl('p',{cls:'hw-set-fields',text:def.fields.map(field=>field.label).join(' · ')});
      }
    };
    let loading=false,again=false;
    const refresh=this.refresh=async()=>{
      if(!view.active)return;if(loading){again=true;return;}loading=true;
      try{
        const next=await store.load();if(!view.active)return;
        layout=next;this.layoutTheme=next.theme;loadError='';error.textContent='';
        if(this.scope)this.scope.dataset.theme=next.theme;
        width.setValue(next.maxWidth===undefined?'':String(next.maxWidth));width.setDisabled(false);
        const type=applyTypography(fontPreview,next.typography);
        fontControl.setValue(type.font).setDisabled(false);sizeControl.setValue(String(type.fontSize)).setDisabled(false);
        if(!lineOptions.has(String(type.lineHeight))){lineOptions.add(String(type.lineHeight));lineControl.addOption(String(type.lineHeight),type.lineHeight+' 倍');}
        lineControl.setValue(String(type.lineHeight)).setDisabled(false);resetControl.setDisabled(false);
        customRow.settingEl.hidden=type.font!=='custom';customControl.setDisabled(type.font!=='custom');
        if(containerEl.ownerDocument.activeElement!==customControl.inputEl)customControl.setValue(type.customFont);
        if(selected!=='general')renderComponents();
      }catch(e){if(view.active){loadError=e.message;error.textContent='读取布局失败：'+e.message;if(selected!=='general')renderComponents();}}
      finally{loading=false;if(again&&view.active){again=false;return refresh();}}
    };
    this.unsub=[store.subscribe(refresh),this.plugin.bus.on('file:'+store.path,refresh),this.plugin.bus.on('registry',()=>{if(view.active&&selected!=='general')renderComponents();}),this.plugin.bus.on('integrations',()=>{if(view.active){renderIntegrations();if(selected!=='general')renderComponents();}})];
    selectTab('general');refresh();
  }
  instanceCard(def,item,store){
    const doc=this.containerEl.ownerDocument,card=doc.createElement('div');card.className='hw-set-card';
    const edit=card.createEl('button',{cls:'hw-set-card-main'});edit.type='button';edit.setAttribute('aria-label','编辑 '+item.title);
    const info=edit.createDiv('hw-set-info');info.createEl('div',{cls:'hw-set-name',text:item.title});
    info.createEl('div',{cls:'hw-set-desc',text:(item.hidden?'已隐藏':'首页显示中')+' · '+item.span+' 列 · '+(item.height?item.height+'px 高':'自适应高度')+(item.cssClasses?' · 样式：'+item.cssClasses:'')});
    const chevron=edit.createEl('span',{cls:'hw-set-chevron',text:'›'});chevron.setAttribute('aria-hidden','true');
    edit.addEventListener('click',()=>this.editWidget(store,item));
    const label=card.createEl('label',{cls:'hw-set-switch'});
    const toggle=label.createEl('input',{type:'checkbox'});toggle.checked=!item.hidden;toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','在首页显示 '+item.title);
    label.createEl('span',{cls:'hw-set-switch-track'}).setAttribute('aria-hidden','true');
    toggle.addEventListener('change',async()=>{
      toggle.disabled=true;
      try{await store.patchWidget(item.id,{hidden:!toggle.checked});}
      catch(e){toggle.checked=!item.hidden;new Notice('Home Widgets：'+e.message);}
      finally{toggle.disabled=false;}
    });
    const remove=card.createEl('button',{cls:'hw-set-delete'});remove.type='button';remove.setAttribute('aria-label','删除实例 '+item.title);remove.append(icon(doc,'trash'));
    remove.addEventListener('click',()=>{if(this.view?.active)this.run(confirmRemoveWidget(this.getForms(),store,item,{isActive:()=>this.view?.active&&this.store===store}));});
    return card;
  }
  getForms(){
    if(!this.forms){
      this.scope=this.containerEl.createDiv('hw-home hw-settings-scope');this.scope.dataset.theme=this.layoutTheme;
      this.forms=createForms(this.scope,(text,error)=>new Notice((error?'⚠ ':'')+'Home Widgets：'+text),this.plugin.services);
    }
    return this.forms;
  }
  editWidget(store,item){
    if(!this.view?.active)return;
    const def=this.plugin.registry.get(item.type);
    this.getForms().show('设置 · '+item.title,configureFields(def),configureInitial(item,def),async value=>{await store.patchWidget(item.id,configurePatch(item,def,value));});
  }
  run(promise){promise.catch(e=>new Notice('Home Widgets：'+e.message));}
  disposeView(){
    this.disposeUpdater?.();this.disposeUpdater=null;
    if(this.view)this.view.active=false;
    this.unsub?.forEach(unsub=>{try{unsub();}catch{}});
    this.unsub=null;this.forms?.dispose();this.forms=null;this.refresh=null;
    this.scope?.remove();this.scope=null;this.store=null;this.view=null;
  }
  hide(){this.disposeView();}
}
module.exports={HomeSettings};
