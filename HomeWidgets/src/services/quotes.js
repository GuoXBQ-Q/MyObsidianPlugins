// Keep source spans so editing one quote preserves the rest of the note verbatim.
function quoteEntries(text){
  const lines=text.replace(/^\uFEFF/,'').split('\n'),entries=[];let current=null,fence=null,start=0;
  const clean=line=>line.replace(/\r$/,'');
  if(clean(lines[0])==='---'){
    const end=lines.findIndex((line,i)=>i>0&&clean(line)==='---');
    if(end<0)throw new Error('引言库的笔记属性缺少结束分隔线');
    start=end+1;
  }
  const flush=()=>{if(current){const body=current.parts.join('\n').trim();if(body)entries.push({body,start:current.start,end:current.end,snapshot:text});}current=null;};
  for(let i=start;i<lines.length;i++){
    const line=clean(lines[i]),marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;continue;}
    if(marker){flush();fence=marker[1];continue;}
    const bullet=/^[-*+]\s+(.*)$/.exec(line);
    if(bullet){flush();current={parts:[bullet[1].trim()],start:i,end:i+1};}
    else if(current&&/^(?: {2,}|\t)\S/.test(line)){current.parts.push(line.trim());current.end=i+1;}
    else if(line.trim())flush();
  }
  flush();return entries;
}
function parseQuotes(text){return [...new Set(quoteEntries(text).map(entry=>entry.body))];}
function cleanQuote(value){const body=String(value||'').replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()).filter(Boolean).join('\n');if(!body)throw new Error('请填写引言内容');return body;}
function quoteMarkdown(body,eol){return body.split('\n').map((line,i)=>(i?'  ':'- ')+line).join(eol);}
function createQuoteService(io){return {
  async list(source){return await io.exists(source)?quoteEntries(await io.read(source)):[];},
  async save(source,value,entry){
    const body=cleanQuote(value);
    if(!await io.exists(source)){
      if(entry)throw new Error('引言库已被移走或删除，请重新载入；你的输入仍保留');
      await io.create(source,'# 引言库\n\n'+quoteMarkdown(body,'\n')+'\n');return;
    }
    await io.update(source,text=>{
      if(entry&&text!==entry.snapshot)throw new Error('引言库已变化，请重新载入后再编辑；你的输入仍保留');
      const entries=quoteEntries(text);
      if(entries.some(item=>item.body===body&&(!entry||item.start!==entry.start)))throw new Error('引言库中已有这句话');
      const eol=text.includes('\r\n')?'\r\n':'\n',markdown=quoteMarkdown(body,eol);
      if(!entry)return text+(text.endsWith('\n')||!text?'':eol)+markdown+eol;
      if(!entries.some(item=>item.start===entry.start&&item.body===entry.body))throw new Error('找不到原引言，请重新载入');
      const lines=text.split('\n');lines.splice(entry.start,entry.end-entry.start,markdown+(eol==='\r\n'&&entry.end<lines.length?'\r':''));return lines.join('\n');
    });
  },
  async remove(source,entry){
    await io.update(source,text=>{
      if(text!==entry.snapshot)throw new Error('引言库已变化，请重新载入后再确认删除');
      if(!quoteEntries(text).some(item=>item.start===entry.start&&item.body===entry.body))throw new Error('找不到原引言，请重新载入');
      const lines=text.split('\n');lines.splice(entry.start,entry.end-entry.start);return lines.join('\n');
    });
  }
};}
module.exports={quoteEntries,parseQuotes,createQuoteService};
