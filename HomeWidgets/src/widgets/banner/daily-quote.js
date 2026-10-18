const {parseQuotes}=require('../../services/quotes');

function dailyQuote(quotes,source,day){
  if(!quotes.length)throw new Error('引言库没有可用的引言，请用「- 」开头添加列表项');
  // A date-seeded choice stays identical across reloads without writing vault data.
  let seed=2166136261;
  for(const char of source+'\0'+day)seed=Math.imul(seed^char.codePointAt(0),16777619)>>>0;
  // Mix the seed before taking the index, so consecutive dates spread over the pool.
  seed=Math.imul(seed^(seed>>>16),2246822507)>>>0;
  seed=Math.imul(seed^(seed>>>13),3266489909)>>>0;
  return quotes[((seed^(seed>>>16))>>>0)%quotes.length];
}
function randomQuote(quotes,current,random=Math.random){
  const others=quotes.filter(quote=>quote!==current);
  return others.length?others[Math.floor(random()*others.length)]:current;
}
module.exports={parseQuotes,dailyQuote,randomQuote};
