const {configureFields,configureInitial,configurePatch}=require('./schema');

function createWidgetInstance(def,title=''){
  if(!def)throw new Error('此组件类型尚未连接，无法新建实例');
  return {id:def.type+'-'+crypto.randomUUID(),type:def.type,title:title.trim()||def.label,span:def.span||4,tint:'plain',settings:JSON.parse(JSON.stringify(def.defaults||{}))};
}

function showNewWidget(forms,registry,store,type,{title='',draft=false}={}){
  const def=registry.get(type),item=createWidgetInstance(def,title);
  return forms.show('新增实例 · '+def.label,configureFields(def),configureInitial(item,def),async value=>{
    if(!registry.get(type))throw new Error('此组件类型已断开，请连接对应插件后重试');
    const patch=configurePatch(item,def,value);
    await store.add({...item,...patch,settings:{...item.settings,...patch.settings}});
  },'创建实例',{
    description:'从此类型的默认配置开始。创建前可修改名称和设置，取消不会添加实例。',
    successMessage:draft?'已添加到本次布局，完成编辑后可保存':'组件实例已创建'
  });
}

async function confirmRemoveWidget(forms,store,item,{draft=false,isActive=()=>true}={}){
  if(item.type==='tasks'){
    const info=await store.describeTaskRemoval(item.id);if(!isActive())return;
    const areaLabel=({work:'工作',life:'生活',study:'学习',uncategorized:'未分类'})[info.area]||info.area;
    const shared=info.peers.length?'\n注意：'+info.peers.map(name=>'「'+name+'」').join('、')+'也读取同文件、同分类，任务处理后会同步受影响。':'';
    return forms.show('删除待办组件',[{key:'taskAction',label:'组件里的任务如何处理？',type:'select',options:[['uncategorize','保留任务，转为未分类（默认）'],['delete','同时删除此分类的全部任务']],help:'保留时任务仍在原文件中，明确标记为未分类；删除时也包含已完成、已隐藏及未显示的任务，其他分类保留。'}],{taskAction:'uncategorize'},value=>store.remove(item.id,{...info,mode:value.taskAction}),'确认删除组件',{
      danger:true,
      description:{message:'删除组件前，请选择对应任务的处理方式。',content:item.title,detail:'源文件：'+info.source+'\n分类：'+areaLabel+'（'+info.area+'）\n全部任务：'+info.count+' 项'+shared+'\n'+(draft?'保存布局后才处理任务；不保存退出则保留组件和原任务。':'确认后立即处理任务并删除组件。')},
      successMessage:draft?'已记录删除及任务处理方式，保存布局后生效':'待办组件及所选任务处理已完成'
    });
  }
  return forms.show('删除组件实例',[],{},()=>store.remove(item.id),'删除实例',{
    danger:true,
    description:{message:'确定删除这个组件实例及其配置？',content:item.title,detail:'关联的笔记、待办、日期和灵感内容会保留，其他实例不受影响。'+(draft?'本次删除在保存布局后生效；不保存退出可恢复。':'删除后无法通过「恢复隐藏」找回此配置。')},
    successMessage:draft?'已从本次布局移除，完成编辑后可保存':'组件实例已删除'
  });
}

module.exports={createWidgetInstance,showNewWidget,confirmRemoveWidget};
