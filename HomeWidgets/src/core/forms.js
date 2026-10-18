const {element,button}=require('./dom');
const {createSelect}=require('./select');
const {createDatePicker}=require('./date-picker');
// One form service. Components provide field schemas, never HTML strings.
function createForms(root,notify,services={}) {
  const doc=root.ownerDocument,opened=new Set();
  function show(title,fields,initial={},onSave,submit='保存',options={}) {
    const dialog=element(doc,'dialog',{class:'hw-dialog'}),form=element(doc,'form');
    const heading=element(doc,'header',{},element(doc,'h2',{},title));
    const close=button(doc,'×',()=>dialog.close(),{'aria-label':'关闭弹窗',class:'hw-button hw-icon-button'});heading.append(close);
    const body=element(doc,'div',{class:'hw-form-body'}),controls=new Map(),cleanups=[],dynamic=[];
    let alive=true;
    if(typeof options.description==='string')body.append(element(doc,'p',{class:'hw-form-confirm'},options.description));
    else if(options.description){
      const {message,content,detail}=options.description;
      if(message)body.append(element(doc,'p',{class:'hw-form-confirm'},message));
      if(content)body.append(element(doc,'strong',{class:'hw-form-confirm-content'},content));
      if(detail)body.append(element(doc,'p',{class:'hw-form-confirm hw-form-confirm-detail'},detail));
    }
    for(const field of fields) {
      const id='hw-field-'+Math.random().toString(36).slice(2),label=element(doc,'label',{for:id},field.label);
      let input,widget;
      if(field.type==='select') {
        let pick=createSelect(doc,{id,name:field.key,label:field.label,options:typeof field.options==='function'?[['','正在读取…']]:field.options});input=pick.input;widget=pick.root;cleanups.push(()=>pick.dispose());
        if(typeof field.options==='function'){
          const state={loading:false,error:'',revision:0,load:async()=>{
            const revision=++state.revision,value=revision===1?String(initial[field.key]??''):controls.get(field.key).value;
            state.loading=true;state.error='';pick.root.querySelector('button').disabled=true;updateReady();
            try{
              const options=await field.options(readValues(),services);if(!alive||revision!==state.revision)return;
              const next=createSelect(doc,{id,name:field.key,label:field.label,options,value:options.some(o=>String(Array.isArray(o)?o[0]:o)===value)?value:''});
              if(field.required)next.input.required=true;
              pick.dispose();pick.root.replaceWith(next.root);pick=next;controls.set(field.key,pick.input);
            }catch(e){if(alive&&revision===state.revision)state.error=field.label+'：'+e.message;}
            finally{if(alive&&revision===state.revision){state.loading=false;updateReady();}}
          }};
          dynamic.push({field,state});
        }
      } else if(field.type==='date'){
        const pick=createDatePicker(doc,{id,name:field.key,label:field.label});input=pick.input;widget=pick.root;cleanups.push(()=>pick.dispose());
      } else if(field.type==='textarea'||field.type==='json') input=element(doc,'textarea',{id,name:field.key,rows:field.type==='json'?6:4,'aria-label':field.label});
      else input=element(doc,'input',{id,name:field.key,type:field.type||'text','aria-label':field.label});
      const value=initial[field.key]??field.default??'';
      if(field.type==='checkbox') input.checked=!!value;
      else if(field.type==='select'){input.value=value===''&&!Array.from(input.options).some(o=>o.value==='')?input.options[0]?.value||'':String(value);input.dispatchEvent(new Event('change'));}
      else input.value=field.type==='json'?JSON.stringify(value,null,2):String(value);
      if(field.required)input.required=true;
      if(field.min!==undefined)input.min=field.min;if(field.max!==undefined)input.max=field.max;
      label.append(widget||input);if(field.help)label.append(element(doc,'small',{},field.help));body.append(label);controls.set(field.key,input);
    }
    const error=element(doc,'p',{role:'alert',class:'hw-form-error'}),footer=element(doc,'footer');
    const save=element(doc,'button',{type:'submit',class:'hw-button '+(options.danger?'hw-danger':'hw-primary')},submit);
    const readValues=()=>Object.fromEntries(fields.map(field=>{const input=controls.get(field.key);return [field.key,field.type==='checkbox'?input.checked:field.type==='number'?Number(input.value):field.type==='json'?JSON.parse(input.value):input.value];}));
    function updateReady(){save.disabled=busy||dynamic.some(({state})=>state.loading||state.error);error.textContent=dynamic.map(({state})=>state.error).filter(Boolean).join('\n');}
    let busy=false;
    const setBusy=value=>{busy=value;close.disabled=value;for(const control of footer.querySelectorAll('button'))control.disabled=value;updateReady();};
    if(options.secondaryAction){
      const action=options.secondaryAction;
      footer.append(button(doc,action.label,async()=>{
        if(busy)return;setBusy(true);error.textContent='';
        try{await action.run();dialog.close();notify(action.successMessage||'已完成');}
        catch(e){setBusy(false);error.textContent=e.message;}
      },{class:'hw-button hw-layout-discard'}));
    }
    footer.append(button(doc,options.cancelLabel||'取消',()=>dialog.close()),save);form.append(heading,body,error,footer);dialog.append(form);root.append(dialog);opened.add(dialog);
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    const previous=doc.activeElement;
    dialog.addEventListener('close',()=>{alive=false;for(const cleanup of cleanups)cleanup();opened.delete(dialog);dialog.remove();previous?.focus();});
    form.addEventListener('change',event=>{for(const {field,state} of dynamic)if(field.dependsOn?.includes(event.target.name))state.load();});
    form.addEventListener('submit',async event=>{event.preventDefault();if(busy||dynamic.some(({state})=>state.loading||state.error))return;setBusy(true);error.textContent='';try{
      const value=readValues();
      await onSave(value);dialog.close();notify(options.successMessage||'已保存');
    }catch(e){setBusy(false);error.textContent=e.message;}});
    dialog.showModal();for(const {state} of dynamic)state.load();return dialog;
  }
  function panel(title,className=''){
    const dialog=element(doc,'dialog',{class:'hw-dialog '+className,'aria-label':title}),body=element(doc,'div',{class:'hw-panel-body'});
    let busy=false,alive=true;const previous=doc.activeElement;
    const close=button(doc,'×',()=>dialog.close(),{'aria-label':'关闭弹窗',class:'hw-button hw-icon-button'});
    dialog.append(element(doc,'header',{},element(doc,'h2',{},title),close),body);root.append(dialog);opened.add(dialog);
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>{alive=false;opened.delete(dialog);dialog.remove();previous?.focus();},{once:true});
    dialog.showModal();
    return {dialog,body,get alive(){return alive;},setBusy(value){busy=value;close.disabled=value;}};
  }
  return {show,panel,confirm(title,description,onConfirm,submit='确认'){return show(title,[],{},onConfirm,submit,{description,danger:true,successMessage:'已删除'});},get active(){return opened.size>0;},dispose(){for(const d of [...opened]){d.close();d.remove();}opened.clear();}};
}
module.exports={createForms};
