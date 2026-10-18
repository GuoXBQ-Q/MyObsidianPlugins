// Shared configure schema so the host toolbar and the plugin settings tab offer
// exactly the same fields for every widget instance. The form key `widgetHeight`
// maps to the stored item.height; frameless widgets keep managing their own size.
const {cssClasses}=require('./appearance');
function configureFields(def){
  return [{key:'title',label:'组件标题'},
    {key:'span',label:'占据列数（1–12）',type:'number',min:1,max:12,required:true},
    ...(def?.frameless?[]:[{key:'widgetHeight',label:'固定高度（像素，留空自适应）',type:'number',min:80,max:2000,help:'设置后内容超出时在组件内部滚动，不再撑高卡片'}]),
    {key:'tint',label:'背景风格',type:'select',options:[['plain','奶白'],['lavender','浅紫'],['rose','樱粉'],['sage','鼠尾草绿']]},
    {key:'background',label:'背景图片（库内路径，可选）'},
    {key:'cssClasses',label:'CSS 样式类（可选）',help:'例如 work-focus 或 soft-card，多个类用空格分隔，不带点号。在 Obsidian CSS 片段中用 .hw-widget.work-focus 设置样式。'},
    ...(def?.fields||[])];
}
function configureInitial(item,def){
  return {...item,...def?.defaults,...item.settings,cssClasses:item.cssClasses||'',widgetHeight:def?.frameless?undefined:(item.height||'')};
}
function configurePatch(item,def,value){
  const {title,span,tint,background,widgetHeight,cssClasses:classes,...settings}=value;
  const height=def?.frameless||widgetHeight===undefined?item.height:widgetHeight>0?widgetHeight:undefined;
  return {title,span,tint,background,height,cssClasses:cssClasses(classes).join(' '),settings};
}
module.exports={configureFields,configureInitial,configurePatch};
