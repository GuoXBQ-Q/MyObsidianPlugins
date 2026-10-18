const fs=require('node:fs'),path=require('node:path');
require('./build.cjs');
const ROOT=path.resolve(__dirname,'..'),vault=path.resolve(ROOT,'..'),target=path.join(vault,'.obsidian/plugins/home-widgets');
fs.mkdirSync(target,{recursive:true});
for(const name of ['main.js','styles.css','manifest.json'])fs.copyFileSync(path.join(ROOT,'build',name),path.join(target,name));
console.log('Installed '+target+' (enable Home Widgets or reload Obsidian to load the new build).');
