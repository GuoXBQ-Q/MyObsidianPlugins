function daysUntil(date,now=new Date()) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('日期格式应为 YYYY-MM-DD');
  const [y,m,d]=date.split('-').map(Number),check=new Date(Date.UTC(y,m-1,d));
  if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)throw new Error('无效日期');
  return Math.round((Date.UTC(y,m-1,d)-Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
}
function localDay(now=new Date()){return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');}
module.exports={daysUntil,localDay};
