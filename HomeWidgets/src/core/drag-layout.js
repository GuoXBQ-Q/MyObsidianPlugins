const {Lifetime}=require('./lifecycle');

// Moving onto a neighbour occupies that neighbour's index in either direction.
// Always inserting "before" the target is a no-op when it is the next card.
function moveToTarget(items,from,to){
  const source=items.findIndex(item=>item.id===from),target=items.findIndex(item=>item.id===to);
  if(source<0||target<0||source===target)return items;
  const next=[...items],[item]=next.splice(source,1);next.splice(target,0,item);return next;
}

function findTarget(cards,source,x,y,bounds){
  if(x<bounds.left-16||x>bounds.right+16||y<bounds.top-16||y>bounds.bottom+16)return null;
  let nearest=null,distance=Infinity;
  for(const card of cards){
    const rect=card.getBoundingClientRect();
    const dx=Math.max(rect.left-x,0,x-rect.right),dy=Math.max(rect.top-y,0,y-rect.bottom);
    if(dx===0&&dy===0)return card===source?null:card;
    if(card!==source&&dx*dx+dy*dy<distance){distance=dx*dx+dy*dy;nearest=card;}
  }
  return nearest;
}

// Pointer Events work with mouse, pen and touch, including Electron/WebViews.
// This belongs to the host and has no knowledge of any widget's business logic.
function createLayoutDrag({grid,root,isEditing,onMove,onError=()=>{}}){
  const life=new Lifetime(),doc=grid.ownerDocument,win=doc.defaultView;
  let session=null,saving=false,frame=null;
  const cards=()=>Array.from(grid.children).filter(el=>el.hasAttribute('data-widget-id'));
  function clearTarget(){for(const card of cards())card.classList.remove('hw-drop-before','hw-drop-after');}
  function clear(){
    const old=session;session=null;if(frame!==null){win.cancelAnimationFrame(frame);frame=null;}
    if(!old)return;
    old.card.classList.remove('hw-drag-source');root.classList.remove('is-dragging');old.preview?.remove();clearTarget();
    try{if(old.header.hasPointerCapture?.(old.pointerId))old.header.releasePointerCapture(old.pointerId);}catch{/* The pointer may already have been cancelled. */}
  }
  function updateTarget(x,y){
    if(!session?.active)return;
    const all=cards(),target=findTarget(all,session.card,x,y,grid.getBoundingClientRect());
    clearTarget();session.target=target;
    if(target)target.classList.add(all.indexOf(session.card)<all.indexOf(target)?'hw-drop-after':'hw-drop-before');
    session.preview.style.left=(x+14)+'px';session.preview.style.top=(y+14)+'px';
  }
  function down(event){
    if(!isEditing()||saving||session||event.isPrimary===false||event.button!==0)return;
    const target=event.target?.closest?.('.hw-widget-header');if(!target||!grid.contains(target))return;
    const control=event.target.closest('button,input,select,textarea,a,[contenteditable]');
    if(control&&!control.classList.contains('hw-grip'))return;
    const card=target.closest('[data-widget-id]');if(!card||card.parentElement!==grid)return;
    event.preventDefault();session={card,header:target,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false,target:null};
    try{target.setPointerCapture?.(event.pointerId);}catch{/* Document listeners also cover runtimes without capture support. */}
  }
  function move(event){
    if(!session||event.pointerId!==session.pointerId)return;
    session.x=event.clientX;session.y=event.clientY;
    if(!session.active){
      if(Math.hypot(session.x-session.startX,session.y-session.startY)<6)return;
      session.active=true;session.card.classList.add('hw-drag-source');root.classList.add('is-dragging');
      const preview=doc.createElement('div');preview.className='home-widgets-drag-preview';preview.setAttribute('aria-hidden','true');preview.textContent='⠿ '+(session.card.getAttribute('aria-label')||'小组件');doc.body.append(preview);session.preview=preview;
    }
    event.preventDefault();updateTarget(session.x,session.y);
    // Follow the pointer at scroll edges, without depending on native HTML drag.
    if(frame===null)frame=win.requestAnimationFrame(scroll);
  }
  function scroll(){
    frame=null;if(!session?.active)return;
    const scroller=grid.closest('.markdown-preview-view,.cm-scroller')||doc.scrollingElement;
    if(!scroller)return;
    const rect=scroller===doc.scrollingElement?{top:0,bottom:win.innerHeight}:scroller.getBoundingClientRect(),margin=52;
    const speed=session.y<rect.top+margin?-12:session.y>rect.bottom-margin?12:0;
    if(speed){const previous=scroller.scrollTop;scroller.scrollTop+=speed;if(scroller.scrollTop!==previous)updateTarget(session.x,session.y);}
    if(session?.active)frame=win.requestAnimationFrame(scroll);
  }
  function up(event){
    if(!session||event.pointerId!==session.pointerId)return;
    if(session.active)updateTarget(event.clientX,event.clientY);
    const {card,target,active}=session,from=card.getAttribute('data-widget-id'),to=target?.getAttribute('data-widget-id');clear();
    if(active&&to){saving=true;Promise.resolve().then(()=>onMove(from,to)).catch(onError).finally(()=>saving=false);}
  }
  life.listen(grid,'pointerdown',down);
  life.listen(doc,'pointermove',move,{passive:false});life.listen(doc,'pointerup',up);
  life.listen(doc,'pointercancel',clear);life.listen(doc,'keydown',event=>{if(event.key==='Escape')clear();});
  life.listen(win,'blur',clear);
  life.listen(grid,'dragstart',event=>{if(isEditing())event.preventDefault();});
  life.own(clear);
  return {cancel:clear,dispose:()=>life.dispose()};
}
module.exports={moveToTarget,findTarget,createLayoutDrag};
