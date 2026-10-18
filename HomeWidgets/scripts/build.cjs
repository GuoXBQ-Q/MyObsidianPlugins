const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),out=path.join(ROOT,'build');fs.mkdirSync(out,{recursive:true});
// A deliberately small CommonJS bundler. No install step or runtime eval is needed.
function bundle(entry,browser=false){const modules=new Map();
  function add(file){file=path.resolve(file);if(modules.has(file))return;let source=fs.readFileSync(file,'utf8');modules.set(file,'');
    source=source.replace(/require\((['"])([^'"]+)\1\)/g,(match,quote,name)=>{
      if(!name.startsWith('.')){if(name!=='obsidian'||browser)throw new Error('Unexpected external module '+name);return 'externalRequire("obsidian")';}
      let target=path.resolve(path.dirname(file),name);if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.js');else if(!path.extname(target))target+='.js';add(target);return '__require('+JSON.stringify(path.relative(ROOT,target).replaceAll('\\','/'))+')';
    });modules.set(file,source);
  }
  add(path.join(ROOT,entry));const id=path.relative(ROOT,path.join(ROOT,entry)).replaceAll('\\','/');
  return '(function(externalRequire){\n"use strict";\nconst modules={\n'+[...modules].map(([file,source])=>JSON.stringify(path.relative(ROOT,file).replaceAll('\\','/'))+':function(module,exports,__require){\n'+source+'\n}').join(',\n')+'\n};const cache={};function __require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;if(!modules[id])throw new Error("Missing module "+id);modules[id](m,m.exports,__require);return m.exports;}\n'+(browser?'window.HomeWidgetsPreview=__require('+JSON.stringify(id)+');':'module.exports=__require('+JSON.stringify(id)+');')+'\n})('+(browser?'null':'require')+');\n';
}
fs.writeFileSync(path.join(out,'main.js'),bundle('src/main.js'));
fs.writeFileSync(path.join(out,'preview.js'),bundle('src/preview.js',true));
const cssFiles=[path.join(ROOT,'src/core/styles.css'),...fs.readdirSync(path.join(ROOT,'src/widgets')).filter(n=>fs.existsSync(path.join(ROOT,'src/widgets',n,'styles.css'))).sort().map(n=>path.join(ROOT,'src/widgets',n,'styles.css')),path.join(ROOT,'src/core/typography.css')];
fs.writeFileSync(path.join(out,'styles.css'),cssFiles.map(f=>'/* '+path.relative(ROOT,f).replaceAll('\\','/')+' */\n'+fs.readFileSync(f,'utf8')).join('\n'));
fs.copyFileSync(path.join(ROOT,'manifest.json'),path.join(out,'manifest.json'));
console.log('Built Home Widgets: main.js, styles.css, manifest.json and shared preview.js');
