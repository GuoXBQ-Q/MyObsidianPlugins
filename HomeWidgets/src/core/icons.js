const NS='http://www.w3.org/2000/svg';
function icon(doc,name){
  const svg=doc.createElementNS(NS,'svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,String(value));
  const paths={restore:['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8','M3 3v5h5'],calendar:['M8 3v4M16 3v4M3 11h18','M8 15h2M14 15h2M8 19h2'],edit:['M16 3l5 5L8 21l-5 1 1-5L16 3Z','M13 6l5 5'],trash:['M3 6h18M9 6V3h6v3','M5 6l1 15h12l1-15M10 10v7M14 10v7'],tasks:['M10 6h10M10 12h10M10 18h10','m3 6 2 2 3-4m-5 8 2 2 3-4m-5 8 2 2 3-4']};
  paths.hide=['M3 3l18 18','M10.6 10.6a2 2 0 0 0 2.8 2.8','M9.9 5.2A11 11 0 0 1 12 5c6 0 10 7 10 7a16 16 0 0 1-3 4','M6.4 6.4C3.5 8.5 2 12 2 12s4 7 10 7c2 0 3.8-.8 5.3-1.7'];
  paths.hourglass=['M5 3h14M5 21h14','M6 3v4c0 2 3 4 6 5-3 1-6 3-6 5v4M18 3v4c0 2-3 4-6 5 3 1 6 3 6 5v4'];
  paths.plus=['M12 5v14M5 12h14'];
  paths.archive=['M3 3h18v4H3V3Z','M5 7v14h14V7','M10 11h4'];
  paths.pin=['M9 3h6M10 3v6l-4 5v2h12v-2l-4-5V3M12 16v5'];
  paths.coffee=['M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z','M17 10h2a3 3 0 0 1 0 6h-2M7 3v3M11 2v4M15 3v3M3 22h16'];
  paths.sparkles=['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z'];
  paths.tag=['M3 3h8l10 10-8 8L3 11V3Z','M7 7h.01'];
  paths.upload=['M12 16V4m-5 5 5-5 5 5','M5 20h14'];
  if(name==='calendar'){const rect=doc.createElementNS(NS,'rect');for(const [key,value] of Object.entries({x:3,y:5,width:18,height:16,rx:2}))rect.setAttribute(key,String(value));svg.append(rect);}
  for(const d of paths[name]||[]){const path=doc.createElementNS(NS,'path');path.setAttribute('d',d);svg.append(path);}
  return svg;
}
function widgetIcon(doc,definition){
  if(typeof definition?.icon==='function')return definition.icon(doc);
  const glyph=doc.createElement('span');glyph.textContent=definition?.icon||'◇';return glyph;
}
function widgetHeadingContent(doc,definition,title){
  const mark=doc.createElement('span');mark.className='hw-widget-icon';mark.setAttribute('aria-hidden','true');mark.append(widgetIcon(doc,definition));
  if(!definition?.subtitle)return [mark,title];
  const copy=doc.createElement('span');copy.className='hw-widget-heading-copy';
  const label=doc.createElement('span');label.className='hw-widget-heading-title';label.textContent=title;
  const subtitle=doc.createElement('small');subtitle.className='hw-widget-subtitle';subtitle.textContent=definition.subtitle;
  copy.append(label,subtitle);return [mark,copy];
}
module.exports={icon,widgetIcon,widgetHeadingContent};
