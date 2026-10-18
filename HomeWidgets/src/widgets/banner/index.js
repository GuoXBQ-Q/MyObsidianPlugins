const {element,button,safeAsset}=require('../../core/dom');
const {icon}=require('../../core/icons');
const {localDay}=require('../../services/date');
const {parseQuotes,dailyQuote,randomQuote}=require('./daily-quote');
const {showQuoteManager}=require('./quote-manager');

// These decorative SVGs contain only fixed local markup.
function decoration(doc,kind){
  const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox',kind==='house'?'0 0 80 80':'0 0 40 40');
  svg.setAttribute('class','hw-banner-'+kind);svg.setAttribute('aria-hidden','true');
  svg.innerHTML=kind==='house'?'<g stroke="#68617d" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><path d="M20 39 45 15 65 40 63 67 22 70Z" fill="#faf4ec"/><path d="m12 42 29-33 9 2 22 30-10 3-19-23-21 26Z" fill="#9991b2"/><path d="m39 12 1-8 7-1 1 10" fill="#b5b4c9" stroke="#9894ae"/><path d="m37 68-1-20q7-7 14-1l1 20" fill="#e9c7bb"/><path d="m43 32 5-1 1 7-6 1Z" fill="#e9cda8"/><path d="m16 71 51-4" fill="none"/></g><path d="m71 5 2 6 6 2-6 3-2 6-2-6-6-3 6-2Z" fill="#eaa3bb"/>':'<g fill="#fac1d3" stroke="#eea8c1" stroke-width=".8"><path d="M20 20C4 12 12 0 20 13 25-3 39 7 27 18 44 15 43 31 27 26 35 41 19 45 18 29 5 40-4 25 13 22Z"/></g><circle cx="21" cy="22" r="4" fill="#ffe4b8"/>';
  return svg;
}
module.exports={type:'banner',label:'Banner',icon:'✧',span:12,frameless:true,frame:'none',
  defaults:{image:'Home/assets/home-cozy-banner.png',heading:'HOME',subtitle:'今天也要高效又开心',quoteSource:'Home/引言库.md',quoteMode:'daily',selectedQuote:'',quote:'把想做的事，一点一点变成现实吧。\n—— 比昨天更进一步，\n就是最棒的成长！',eyebrow:'',height:210,position:50,showDate:false},
  fields:[
    {key:'image',label:'Banner 图片路径'},{key:'heading',label:'主标题'},{key:'subtitle',label:'副标题'},
    {key:'quoteSource',label:'每日引言库（笔记路径）',help:'从笔记列表中每天选一句，当天保持不变。留空时使用下面的固定引言。'},
    {key:'quote',label:'固定／备用引言（支持换行）',type:'textarea',help:'未使用引言库或读取失败时显示；两项都留空则隐藏引言框。'},
    {key:'eyebrow',label:'顶部小字（可选）'},{key:'height',label:'高度（像素）',type:'number',min:140,max:800},
    {key:'position',label:'图片垂直焦点（0–100）',type:'number',min:0,max:100},{key:'showDate',label:'显示今天日期',type:'checkbox'}
  ],
  watch:c=>c.quoteSource?.trim()?['file:'+c.quoteSource.trim()]:[],
  async mount(ctx){
    const c=ctx.config,hero=element(ctx.doc,'div',{class:'hw-banner'}),copy=element(ctx.doc,'div',{class:'hw-banner-copy'});
    if(!['daily','manual'].includes(c.quoteMode)||typeof c.selectedQuote!=='string')throw new Error('引言显示模式或手动选择内容无效');
    const source=c.quoteSource?.trim()||'',day=localDay();let quote=c.quote,quoteError='',quotes=[],storage;
    const choiceKey='home-widgets-banner-quote:'+JSON.stringify([ctx.platform?.vaultId,ctx.id,source]);
    try{storage=ctx.doc.defaultView?.localStorage;}catch{/* Session memory still works when storage is blocked. */}
    if(source){
      try{
        quotes=parseQuotes(await ctx.services.io.read(source));quote=dailyQuote(quotes,source,day);
        let saved;
        try{saved=JSON.parse(storage?.getItem(choiceKey)||'null');}catch{/* Ignore an unreadable device preference. */}
        const choice=[ctx.local?.bannerQuoteChoice,saved].find(value=>value?.day===day&&value.source===source&&quotes.includes(value.quote));
        if(c.quoteMode==='manual'){
          if(quotes.includes(c.selectedQuote))quote=c.selectedQuote;
          else quoteError='手动选择的引言已不在库中，暂时显示每日一句；请在引言库中重新选择。';
        }else if(choice)quote=choice.quote;
      }
      catch(e){quoteError='引言库暂不可用：'+e.message;}
      if(ctx.signal.aborted)return;
    }
    safeAsset(c.image);
    const scene=element(ctx.doc,'div',{class:'hw-banner-scene','aria-hidden':'true'});
    const art=element(ctx.doc,'img',{class:'hw-banner-art',src:ctx.services.io.resource(c.image),alt:'',decoding:'async'});
    art.style.objectPosition='72% '+Math.max(0,Math.min(100,Number(c.position)||0))+'%';scene.append(art);
    hero.style.minHeight=Math.max(140,Math.min(800,Number(c.height)||210))+'px';
    if(c.eyebrow)copy.append(element(ctx.doc,'div',{class:'hw-banner-eyebrow'},c.eyebrow));
    copy.append(element(ctx.doc,'div',{class:'hw-banner-heading'},decoration(ctx.doc,'house'),element(ctx.doc,'h1',{},c.heading)));
    if(c.subtitle)copy.append(element(ctx.doc,'p',{class:'hw-banner-subtitle'},c.subtitle,element(ctx.doc,'span',{'aria-hidden':'true'},'✦')));
    if(quote||source){
      const text=element(ctx.doc,'p',{'aria-live':'polite'},quote||'为今天留下一句喜欢的话。');
      const card=element(ctx.doc,'blockquote',{class:'hw-banner-quote'},element(ctx.doc,'span',{class:'hw-banner-quote-mark','aria-hidden':'true'},'“'),text,decoration(ctx.doc,'flower'));
      if(source){
        card.setAttribute('aria-description',c.quoteMode==='manual'?'手动设置的引言':'每日一句 · '+day);
        const tools=element(ctx.doc,'div',{class:'hw-banner-quote-tools'});
        const shuffle=button(ctx.doc,'',async()=>{
          if(ctx.signal.aborted||shuffle.disabled)return;
          if(localDay()!==day){ctx.refresh();return;}
          const next=randomQuote(quotes,quote);
          if(c.quoteMode==='manual'){
            shuffle.disabled=true;
            try{await ctx.updateConfig({quoteMode:'manual',selectedQuote:next});if(!ctx.signal.aborted){quote=next;text.textContent=quote;}}
            catch(e){if(!ctx.signal.aborted)ctx.notify('切换引言失败：'+e.message,true);}
            finally{if(!ctx.signal.aborted)shuffle.disabled=quotes.length<2;}
            return;
          }
          quote=next;text.textContent=quote;
          const choice={day,source,quote};if(ctx.local)ctx.local.bannerQuoteChoice=choice;
          try{storage?.setItem(choiceKey,JSON.stringify(choice));}catch{/* Preserve the selection in this session. */}
        },{class:'hw-button hw-icon-button hw-banner-quote-random','aria-label':'随机换一句','aria-description':quotes.length<2?'引言库至少需要两条不同的引言才能切换':undefined});
        shuffle.disabled=quotes.length<2;shuffle.append(icon(ctx.doc,'restore'));
        const edit=button(ctx.doc,'',()=>showQuoteManager(ctx,source),{class:'hw-button hw-icon-button hw-banner-quote-edit','aria-label':'管理引言库'});
        edit.append(icon(ctx.doc,'edit'));tools.append(shuffle,edit);card.append(tools);
      }
      copy.append(card);
      if(quoteError)copy.append(element(ctx.doc,'small',{class:'hw-banner-quote-status',role:'status'},quoteError));
    }
    if(c.showDate){
      const date=element(ctx.doc,'div',{class:'hw-banner-date'});
      const update=()=>date.textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
      update();ctx.lifetime.interval(update,60000);copy.append(date);
    }
    copy.append(element(ctx.doc,'span',{class:'hw-banner-spark hw-banner-spark-one','aria-hidden':'true'},'✦'),element(ctx.doc,'span',{class:'hw-banner-spark hw-banner-spark-two','aria-hidden':'true'},'✦'));
    hero.append(scene,copy);ctx.el.append(hero);
    if(source){
      const checkDay=()=>{if(localDay()!==day)return ctx.refresh();};
      ctx.lifetime.interval(checkDay,60000);
      ctx.lifetime.listen(ctx.doc,'visibilitychange',checkDay);
      if(ctx.doc.defaultView)ctx.lifetime.listen(ctx.doc.defaultView,'focus',checkDay);
    }
  }
};


