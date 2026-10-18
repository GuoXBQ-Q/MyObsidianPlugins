const {element}=require('./dom');
let seq=0;
// Themed dropdown: the visible control is a button plus a listbox layer; a visually
// hidden native <select> stores the value so forms and widgets keep reading input.value.
// The list is placed inside the nearest dialog or .hw-home (both are containing blocks)
// so it escapes the widget card clipping and the dialog top layer.
function createSelect(doc,{id,label='',name,options=[],value=''}={}) {
  const win=doc.defaultView,choices=options.map(item=>Array.isArray(item)?{value:item[0],text:item[1]}:{value:item,text:String(item)});
  const root=element(doc,'div',{class:'hw-select'}),base=(id||'hw-select-'+seq++)+'-opt-';
  const input=element(doc,'select',{class:'hw-select-native',name,'aria-hidden':'true',tabindex:-1});
  for(const item of choices)input.append(element(doc,'option',{value:item.value},item.text));
  input.value=value;
  const text=element(doc,'span',{class:'hw-select-value'});
  const btn=element(doc,'button',{type:'button',class:'hw-select-button',id,'aria-haspopup':'listbox','aria-expanded':'false'},text);
  const list=element(doc,'div',{class:'hw-select-list',role:'listbox','aria-label':label});
  const items=choices.map((item,i)=>element(doc,'div',{class:'hw-select-option',role:'option','aria-selected':'false',id:base+i,'data-value':item.value},item.text));
  list.append(...items);
  root.append(btn,input);
  let open=false,active=-1,host=null;
  const current=()=>input.options[input.selectedIndex]?.value??'';
  function paint(){const now=current();text.textContent=choices.find(item=>item.value===now)?.text??now;
    for(const el of items)el.setAttribute('aria-selected',String(el.dataset.value===now));}
  function setActive(i){active=(i+items.length)%items.length;
    items.forEach((el,j)=>el.classList.toggle('is-active',j===active));
    btn.setAttribute('aria-activedescendant',items[active].id);
    // Only scroll the list itself when needed; a bare scrollIntoView also scrolls
    // ancestor containers, which the outside-scroll close handler treats as dismissal.
    const el=items[active],box=list.getBoundingClientRect(),r=el.getBoundingClientRect();
    if(r.top<box.top||r.bottom>box.bottom)el.scrollIntoView({block:'nearest'});}
  function close(){if(!open)return;open=false;root.classList.remove('is-open');list.classList.remove('is-open');btn.setAttribute('aria-expanded','false');
    doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('scroll',onScroll,true);win.removeEventListener('resize',close);}
  function outside(event){if(!root.contains(event.target)&&!list.contains(event.target))close();}
  function onScroll(event){if(list.contains(event.target))return;if(host&&host.contains(event.target))close();}
  // Position against the containing block that actually anchors the list: the dialog
  // (top layer, absolute), .hw-home (layout containment, escapes card clipping) or the body.
  // The list height is capped to the chosen side so short dialogs never clip it, and the
  // width follows the button (min-width:100% would resolve against the mount layer).
  function place(){
    const anchor=btn.getBoundingClientRect();host=root.closest('dialog')||root.closest('.hw-home')||doc.body;
    if(list.parentNode!==host){host.append(list);if(host instanceof host.ownerDocument.defaultView.HTMLDialogElement)host.addEventListener('close',close,{once:true});}
    list.style.visibility='hidden';
    const fixed=host===doc.body;
    const box=fixed?{left:0,top:0,bottom:win.innerHeight}:host.getBoundingClientRect();
    const roomBelow=box.bottom-anchor.bottom-12,roomAbove=anchor.top-box.top-12;
    list.style.position=fixed?'fixed':'absolute';list.style.top=list.style.bottom='';
    list.style.left=(anchor.left-box.left)+'px';
    list.style.width=Math.max(anchor.width,Math.min(list.offsetWidth||0,280))+'px';list.style.minWidth='';
    if(roomAbove>roomBelow&&roomAbove>90){list.style.bottom=(box.bottom-anchor.top+5)+'px';list.style.maxHeight=Math.min(246,roomAbove)+'px';}
    else{list.style.top=(anchor.bottom-box.top+5)+'px';list.style.maxHeight=Math.min(246,Math.max(roomBelow,90))+'px';}
    list.style.visibility='';
  }
  function openList(){if(open)return;open=true;root.classList.add('is-open');list.classList.add('is-open');btn.setAttribute('aria-expanded','true');
    place();const at=choices.findIndex(item=>item.value===current());setActive(at<0?0:at);
    doc.addEventListener('pointerdown',outside,true);doc.addEventListener('scroll',onScroll,true);win.addEventListener('resize',close);}
  function choose(i){const previous=current();input.value=choices[i].value;paint();close();btn.focus();if(current()!==previous)input.dispatchEvent(new win.Event('change',{bubbles:true}));}
  btn.addEventListener('click',()=>open?close():openList());
  btn.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open?setActive(active+(event.key==='ArrowDown'?1:-1)):openList();}
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();open&&active>=0?choose(active):openList();}
    else if(event.key==='Home'&&open){event.preventDefault();setActive(0);}
    else if(event.key==='End'&&open){event.preventDefault();setActive(items.length-1);}
    else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();}});
  for(const [i,el] of items.entries()){el.addEventListener('pointermove',()=>setActive(i));el.addEventListener('click',()=>choose(i));}
  input.addEventListener('change',paint);
  paint();
  return {root,input,dispose(){close();host?.removeEventListener('close',close);list.remove();}};
}
module.exports={createSelect};
