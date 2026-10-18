function cssClasses(value=''){
  if(typeof value!=='string')throw new Error('CSS 样式类必须为文字');
  const classes=[...new Set(value.trim().split(/\s+/).filter(Boolean))];
  for(const name of classes){
    if(!/^[a-zA-Z_][\w-]*$/.test(name))throw new Error('CSS 类名请使用英文字母、数字、短横线或下划线，以字母或下划线开头，不带点号');
    if(/^(hw-|is-|home-widgets-)/.test(name))throw new Error('hw-、is- 和 home-widgets- 是组件保留前缀，请换一个 CSS 类名');
  }
  return classes;
}
function applyCssClasses(element,next,previous){
  const before=new Set(cssClasses(previous)),after=new Set(cssClasses(next));
  for(const name of before)if(!after.has(name))element.classList.remove(name);
  for(const name of after)if(!before.has(name))element.classList.add(name);
}
function hasWidgetFrame(definition){return definition?.frame!=='none';}
module.exports={cssClasses,applyCssClasses,hasWidgetFrame};
