// Task handles own their pointer session; widget layout dragging only uses headers.
function createTaskDrag({list,doc,entries,onMove,onError,signal}){
  const win=doc.defaultView,listeners=[];let session=null,saving=false,frame=null;
  const same=(a,b)=>a.task.parentLine===b.task.parentLine&&a.task.area===b.task.area&&(a.task.parentLine!==null||a.task.done===b.task.done);
  const peers=entry=>entries.filter(item=>!item.disabled&&same(entry,item));
  function listen(node,type,fn,options){node.addEventListener(type,fn,options);listeners.push(()=>node.removeEventListener(type,fn,options));}
  function clear(){
    if(frame!==null){win.cancelAnimationFrame(frame);frame=null;}
    for(const entry of entries)entry.el.classList.remove('is-task-dragging','hw-task-drop-before','hw-task-drop-after');
    if(session){session.entry.handle.setAttribute('aria-grabbed','false');try{session.entry.handle.releasePointerCapture(session.pointerId);}catch{}}
    session=null;
  }
  function targetAt(x,y){
    if(!session?.active)return;
    const bounds=list.getBoundingClientRect();let target=null,after=false;
    for(const entry of entries)entry.el.classList.remove('hw-task-drop-before','hw-task-drop-after');
    if(x>=bounds.left&&x<=bounds.right&&y>=bounds.top-16&&y<=bounds.bottom+16){
      const candidates=peers(session.entry);
      for(const entry of candidates){
        if(entry===session.entry)continue;const rect=entry.el.getBoundingClientRect();
        if(y>=rect.top&&y<=rect.bottom){target=entry;after=y>(rect.top+rect.bottom)/2;break;}
      }
    }
    session.target=target;session.after=after;if(target)target.el.classList.add(after?'hw-task-drop-after':'hw-task-drop-before');
  }
  function scroll(){
    frame=null;if(!session?.active)return;
    const scroller=list.closest('.hw-widget-body'),rect=scroller?.getBoundingClientRect();
    if(rect){const delta=session.y<rect.top+32?-10:session.y>rect.bottom-32?10:0;if(delta){scroller.scrollTop+=delta;targetAt(session.x,session.y);}}
    frame=win.requestAnimationFrame(scroll);
  }
  async function save(entry,target,after){
    if(saving||signal.aborted)return;saving=true;
    try{await onMove(entry.task,target.task,after);}catch(error){onError(error);}finally{saving=false;}
  }
  for(const entry of entries){
    listen(entry.handle,'pointerdown',event=>{
      if(entry.disabled||saving||session||event.button!==0||event.isPrimary===false)return;
      event.preventDefault();event.stopPropagation();entry.handle.focus();
      session={entry,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false};
      try{entry.handle.setPointerCapture(event.pointerId);}catch{}
    });
    listen(entry.handle,'keydown',event=>{
      if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key)||entry.disabled)return;
      event.preventDefault();event.stopPropagation();const all=peers(entry),index=all.indexOf(entry),target=all[index+(event.key==='ArrowUp'?-1:1)];
      if(target)save(entry,target,event.key==='ArrowDown');
    });
  }
  listen(doc,'pointermove',event=>{
    if(!session||session.pointerId!==event.pointerId)return;session.x=event.clientX;session.y=event.clientY;
    if(!session.active&&Math.hypot(session.x-session.startX,session.y-session.startY)>=5){session.active=true;session.entry.el.classList.add('is-task-dragging');session.entry.handle.setAttribute('aria-grabbed','true');}
    if(session.active){event.preventDefault();targetAt(session.x,session.y);if(frame===null)frame=win.requestAnimationFrame(scroll);}
  },{passive:false});
  listen(doc,'pointerup',event=>{
    if(!session||session.pointerId!==event.pointerId)return;if(session.active)targetAt(event.clientX,event.clientY);
    const {entry,target,after,active}=session;clear();if(active&&target)save(entry,target,after);
  });
  listen(doc,'pointercancel',clear);
  listen(doc,'keydown',event=>{if(event.key==='Escape'&&session){event.preventDefault();event.stopPropagation();clear();}},true);
  listen(win,'blur',clear);
  signal.addEventListener('abort',()=>{clear();for(const off of listeners)off();},{once:true});
}
module.exports={createTaskDrag};
