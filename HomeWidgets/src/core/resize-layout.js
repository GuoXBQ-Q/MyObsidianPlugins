const {Lifetime}=require('./lifecycle');
// Edge resize for edit mode: the right grip maps the pointer onto a 12-column span,
// the bottom grip onto a fixed pixel height. Sizes preview live and are saved on release.
function createLayoutResize({grid,root,isEditing,onResize,onError=()=>{}}){
  const life=new Lifetime(),doc=grid.ownerDocument,win=doc.defaultView;
  let session=null;
  function columns(){
    const gap=parseFloat(getComputedStyle(grid).columnGap)||0;
    return {gap,pitch:(grid.clientWidth-(12-1)*gap)/12+gap};
  }
  function clear(){
    const old=session;session=null;
    if(!old)return;
    old.card.classList.remove('hw-resizing');root.classList.remove('is-resizing');
    // Restore the stored size; the patch that follows re-applies the new one.
    old.card.style.gridColumn='span '+old.origSpan;
    if(old.origHeight==null){old.card.style.height='';old.card.classList.remove('hw-fixed');}
    else old.card.style.height=old.origHeight+'px';
    try{if(old.grip.hasPointerCapture?.(old.pointerId))old.grip.releasePointerCapture(old.pointerId);}catch{/* The pointer may already have been cancelled. */}
  }
  function preview(){
    const s=session;if(!s)return;
    if(s.axis==='x'){s.span=Math.max(1,Math.min(12,s.span));s.card.style.gridColumn='span '+s.span;}
    else{s.height=Math.max(80,Math.min(2000,s.height));s.card.style.height=s.height+'px';s.card.classList.add('hw-fixed');}
  }
  function move(event){
    if(!session||event.pointerId!==session.pointerId||event.isPrimary===false)return;
    if(session.axis==='x')session.span=Math.round((event.clientX-session.left+session.metrics.gap)/session.metrics.pitch);
    else session.height=Math.round(event.clientY-session.top);
    event.preventDefault();preview();
  }
  function up(event){
    if(!session||event.pointerId!==session.pointerId)return;
    const {item,axis,span,height,origSpan,origHeight}=session;
    clear();
    try{
      if(axis==='x'&&span!==origSpan)onResize(item.id,{span});
      else if(axis==='y'&&height!==origHeight)onResize(item.id,{height});
    }catch(e){onError(e);}
  }
  function down(event){
    if(!isEditing()||session||event.isPrimary===false||event.button!==0)return;
    const grip=event.target?.closest?.('.hw-resize-grip');if(!grip||!grid.contains(grip))return;
    const card=grip.closest('[data-widget-id]');if(!card||card.parentElement!==grid)return;
    const rect=card.getBoundingClientRect(),axis=grip.classList.contains('hw-resize-x')?'x':'y';
    const origSpan=parseInt(card.style.gridColumn.slice(5),10)||1;
    const origHeight=card.style.height?parseInt(card.style.height,10):null;
    session={pointerId:event.pointerId,grip,card,item:{id:card.getAttribute('data-widget-id')},axis,
      left:rect.left,top:rect.top,metrics:columns(),span:origSpan,height:origHeight??rect.height,origSpan,origHeight};
    card.classList.add('hw-resizing');root.classList.add('is-resizing');
    try{grip.setPointerCapture?.(event.pointerId);}catch{/* Document listeners also cover runtimes without capture support. */}
    event.preventDefault();
  }
  life.listen(grid,'pointerdown',down);
  // Double-click the bottom grip to drop a fixed height back to auto.
  life.listen(grid,'dblclick',event=>{
    if(!isEditing())return;
    const grip=event.target?.closest?.('.hw-resize-y');if(!grip||!grid.contains(grip))return;
    const card=grip.closest('[data-widget-id]');if(!card||card.parentElement!==grid||!card.style.height)return;
    try{onResize(card.getAttribute('data-widget-id'),{height:undefined});}catch(e){onError(e);}
  });
  life.listen(doc,'pointermove',move,{passive:false});life.listen(doc,'pointerup',up);
  life.listen(doc,'pointercancel',clear);life.listen(doc,'keydown',event=>{if(event.key==='Escape')clear();});
  life.listen(win,'blur',clear);
  life.own(clear);
  return {cancel:clear,dispose:()=>life.dispose()};
}
module.exports={createLayoutResize};
