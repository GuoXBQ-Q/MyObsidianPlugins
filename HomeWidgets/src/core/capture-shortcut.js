// Obsidian handles keydown at window capture, before textarea listeners run.
// Prefer its native scope; the window listener also supports browser previews.
function bindCaptureShortcut(root,save,ctx){
  const handled=new WeakSet(),doc=root.ownerDocument||ctx.doc;
  const handle=event=>{
    if(ctx.signal.aborted||handled.has(event))return false;
    if(!root.contains(doc.activeElement))return false;
    if(event.isComposing||event.keyCode===229||event.altKey||event.shiftKey)return false;
    if(!(event.ctrlKey||event.metaKey)||(event.key!=='Enter'&&event.code!=='NumpadEnter'))return false;
    handled.add(event);event.preventDefault();event.stopImmediatePropagation();
    if(!event.repeat&&!save.disabled)save.click();
    return true;
  };
  ctx.services.integrations.bindSaveShortcut?.(root,handle,ctx.lifetime);
  ctx.lifetime.listen(doc.defaultView,'keydown',handle,true);
  return handle;
}
module.exports={bindCaptureShortcut};
