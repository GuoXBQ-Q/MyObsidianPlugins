const DEFAULT_TYPOGRAPHY=Object.freeze({font:'noto-sans-sc',customFont:'',fontSize:15,lineHeight:1.75});
const FONT_OPTIONS=[['noto-sans-sc','Noto Sans SC（默认）'],['text','跟随笔记字体'],['interface','跟随界面字体'],['custom','自定义字体']];
const FALLBACK='"Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif';
const {assertFields}=require('./format');
function validateTypography(value){
  if(value===undefined)return;
  assertFields(value,['font','customFont','fontSize','lineHeight'],'字体排版配置');
  if(value.font!==undefined&&!FONT_OPTIONS.some(([id])=>id===value.font))throw new Error('未知字体选项');
  if(value.customFont!==undefined&&(typeof value.customFont!=='string'||value.customFont.length>100||/[\u0000-\u001f\u007f]/.test(value.customFont)))throw new Error('请输入不超过 100 个字符的字体名称');
  if(value.fontSize!==undefined&&(!Number.isInteger(value.fontSize)||value.fontSize<12||value.fontSize>24))throw new Error('正文字号应为 12–24 的整数');
  if(value.lineHeight!==undefined&&(!Number.isFinite(value.lineHeight)||value.lineHeight<1.2||value.lineHeight>2.4))throw new Error('正文行距应为 1.2–2.4');
}
function typographyValues(value){validateTypography(value);return Object.fromEntries(Object.entries(DEFAULT_TYPOGRAPHY).map(([key,fallback])=>[key,value?.[key]??fallback]));}
function fontFamily(value){
  if(value.font==='text')return 'var(--font-text, '+FALLBACK+')';
  if(value.font==='interface')return 'var(--font-interface, '+FALLBACK+')';
  if(value.font==='custom'&&value.customFont.trim())return '"'+value.customFont.trim().replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'", '+FALLBACK;
  return FALLBACK;
}
function applyTypography(element,value){
  const values=typographyValues(value);
  element.style.setProperty('--hw-font-family',fontFamily(values));
  element.style.setProperty('--hw-body-size',values.fontSize+'px');
  element.style.setProperty('--hw-line-height',String(values.lineHeight));
  return values;
}
module.exports={DEFAULT_TYPOGRAPHY,FONT_OPTIONS,validateTypography,typographyValues,applyTypography};
