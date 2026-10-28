// Copy this folder to src/widgets/quote, then register require('./quote') in widgets/index.js.
const {element}=require('../../core/dom');
module.exports={
  supportsMultipleInstances:false,
  type:'quote',label:'一句话',icon:'❞',span:4,
  defaults:{text:'慢慢来，也是一种前进。',author:'给今天的自己'},
  fields:[{key:'text',label:'内容',type:'textarea'},{key:'author',label:'署名'}],
  mount(ctx){ctx.el.append(element(ctx.doc,'blockquote',{},ctx.config.text),element(ctx.doc,'small',{},ctx.config.author));}
};
