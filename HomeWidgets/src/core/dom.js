function element(doc, tag, attrs = {}, ...children) {
  const el=doc.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') el.className=value;
    else if (key === 'text') el.textContent=value;
    else if (key === 'checked') el.checked=!!value;
    else if (key === 'value') el.value=value;
    else el.setAttribute(key,String(value));
  }
  for (const child of children.flat()) { if (child !== undefined && child !== null) el.append(child.nodeType ? child : doc.createTextNode(String(child))); }
  return el;
}
function button(doc, label, fn, attrs = {}) { const el=element(doc,'button',{type:'button',class:'hw-button',...attrs},label);el.addEventListener('click',fn);return el; }
function empty(doc,text) { return element(doc,'p',{class:'hw-empty'},text); }
function safeAsset(path) { if (/^(https?:|data:|javascript:|file:|app:)/i.test(path)) throw new Error('图片请使用知识库内的相对路径'); return path; }
function paintBackground(el, resource, path, opacity=.9) { if(!path)return;safeAsset(path);const src=resource(path);el.style.backgroundImage=`linear-gradient(rgba(255,254,253,${opacity}),rgba(255,254,253,${opacity})),url("${src.replaceAll('"','%22')}")`;el.style.backgroundSize='cover';el.style.backgroundPosition='center'; }
module.exports={element,button,empty,safeAsset,paintBackground};
