const {element,button}=require('./dom');
const {icon}=require('./icons');
const dateKey=(year,month,day)=>String(year).padStart(4,'0')+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
function createDatePicker(doc,{id,name,label}){
  const root=element(doc,'div',{class:'hw-date'}),field=element(doc,'div',{class:'hw-date-field'});
  const input=element(doc,'input',{id,name,type:'date',class:'hw-date-input','aria-label':label});
  // A native popover occupies the top layer without adding a second modal dialog.
  // It stays a DOM descendant of the form, preserving theme and keyboard scope.
  const calendar=element(doc,'div',{id:id+'-calendar',class:'hw-date-calendar',popover:'manual',role:'group','aria-label':'日期选择器'});calendar.hidden=true;
  const trigger=button(doc,'',()=>calendar.hidden?open():close(),{class:'hw-button hw-date-trigger','aria-label':'选择'+label,'aria-expanded':'false','aria-controls':calendar.id});trigger.append(icon(doc,'calendar'));
  field.append(input,trigger);root.append(field,calendar);
  let year,month,disposed=false;
  const win=doc.defaultView;
  const allowed=value=>(!input.min||value>=input.min)&&(!input.max||value<=input.max);
  function close(){
    if(calendar.matches(':popover-open'))calendar.hidePopover();
    calendar.hidden=true;trigger.setAttribute('aria-expanded','false');
    doc.removeEventListener('click',outside,true);doc.removeEventListener('scroll',onScroll,true);win.removeEventListener('resize',place);
  }
  function place(){
    if(calendar.hidden)return;
    const margin=12,gap=8,anchor=field.getBoundingClientRect(),width=Math.min(300,win.innerWidth-margin*2);
    calendar.style.width=width+'px';calendar.style.maxHeight=Math.max(0,win.innerHeight-margin*2)+'px';
    const height=calendar.getBoundingClientRect().height,below=win.innerHeight-anchor.bottom-gap-margin,above=anchor.top-gap-margin;
    const top=below>=height||below>=above?anchor.bottom+gap:anchor.top-height-gap;
    calendar.style.left=Math.max(margin,Math.min(anchor.right-width,win.innerWidth-width-margin))+'px';
    calendar.style.top=Math.max(margin,Math.min(top,win.innerHeight-height-margin))+'px';
  }
  function onScroll(event){if(!calendar.contains(event.target))place();}
  function outside(event){if(!root.contains(event.target))close();}
  function choose(value){
    input.value=value;close();input.focus();
    for(const type of ['input','change'])input.dispatchEvent(new doc.defaultView.Event(type,{bubbles:true}));
  }
  function navigate(offset){month+=offset;if(month<0){month=11;year--;}else if(month>11){month=0;year++;}render();place();}
  function render(){
    calendar.replaceChildren();
    const header=element(doc,'div',{class:'hw-date-header'});
    const previous=button(doc,'‹',()=>navigate(-1),{class:'hw-button hw-date-nav','aria-label':'上个月'}),next=button(doc,'›',()=>navigate(1),{class:'hw-button hw-date-nav','aria-label':'下个月'});
    previous.disabled=year===1&&month===0||!!input.min&&dateKey(year,month,1)<=input.min.slice(0,7)+'-01';
    next.disabled=year===9999&&month===11||!!input.max&&dateKey(year,month,1)>=input.max.slice(0,7)+'-01';
    header.append(previous,element(doc,'span',{class:'hw-date-caption','aria-live':'polite'},year+' 年 '+(month+1)+' 月'),next);
    const week=element(doc,'div',{class:'hw-date-week','aria-hidden':'true'});for(const day of ['一','二','三','四','五','六','日'])week.append(element(doc,'span',{},day));
    const grid=element(doc,'div',{class:'hw-date-grid'}),first=new Date();first.setHours(0,0,0,0);first.setFullYear(year,month,1);
    const days=new Date(year,month+1,0).getDate(),offset=(first.getDay()+6)%7,now=new Date(),today=dateKey(now.getFullYear(),now.getMonth(),now.getDate());
    for(let i=0;i<offset;i++)grid.append(element(doc,'span',{'aria-hidden':'true'}));
    for(let day=1;day<=days;day++){
      const value=dateKey(year,month,day),selected=input.value===value;
      const pick=button(doc,String(day),()=>choose(value),{class:'hw-button hw-date-day'+(selected?' is-selected':'')+(value===today?' is-today':''),'aria-label':year+'年'+(month+1)+'月'+day+'日','aria-pressed':String(selected)});
      pick.disabled=!allowed(value);if(value===today)pick.setAttribute('aria-current','date');grid.append(pick);
    }
    const footer=element(doc,'div',{class:'hw-date-footer'}),todayButton=button(doc,'今天',()=>choose(today),{class:'hw-button hw-text-button'}),clear=button(doc,'清除日期',()=>choose(''),{class:'hw-button hw-text-button'});
    todayButton.disabled=!allowed(today);clear.disabled=input.required;footer.append(todayButton,clear);calendar.append(header,week,grid,footer);
  }
  function open(){
    if(disposed||input.disabled)return;
    const parts=input.value.match(/^(\d{4})-(\d{2})-(\d{2})$/),now=new Date();
    year=parts?Number(parts[1]):now.getFullYear();month=parts?Number(parts[2])-1:now.getMonth();
    render();calendar.hidden=false;calendar.style.visibility='hidden';calendar.showPopover();place();calendar.style.visibility='';
    trigger.setAttribute('aria-expanded','true');doc.addEventListener('click',outside,true);doc.addEventListener('scroll',onScroll,true);win.addEventListener('resize',place);
  }
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&!calendar.hidden){event.preventDefault();event.stopPropagation();close();trigger.focus();}});
  return {root,input,close,isOpen:()=>!calendar.hidden,dispose(){disposed=true;close();}};
}
module.exports={createDatePicker};
