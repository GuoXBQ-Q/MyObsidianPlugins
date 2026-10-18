const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.MY_CALENDAR_PORT || 8789);
function asset(name) {
	const asarDir = path.join(process.env.APPDATA, 'obsidian');
	const archive = fs.readdirSync(asarDir).filter(n => /^obsidian-.*\.asar$/.test(n)).sort().pop();
	if (!archive) return '';
	const data = fs.readFileSync(path.join(asarDir, archive));
	const header = JSON.parse(data.subarray(16, 16 + data.readUInt32LE(12)));
	const entry = header.files[name], start = 8 + data.readUInt32LE(4) + Number(entry.offset);
	return data.subarray(start, start + entry.size).toString('utf8');
}
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyCalendar 弹窗预览</title><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/styles.css"><style>
html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;min-height:100vh;height:auto;padding:24px;background:var(--background-secondary);--interactive-accent:#df8c79;--interactive-accent-hover:#cf7968}nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 auto 20px;max-width:620px}#stage{max-width:620px;margin:auto}#stage .modal{position:static;max-width:100%;width:100%;padding:24px;box-sizing:border-box;box-shadow:0 12px 45px #0001}#stage .modal-content{margin:0;overflow:visible}#notice{max-width:620px;margin:12px auto;color:var(--text-error)}details{max-width:620px;margin:12px auto;font-size:12px}pre{white-space:pre-wrap}.narrow #stage{max-width:340px}.narrow .mc-color-row:not(.mc-color-recent){grid-template-columns:repeat(6,minmax(0,1fr))}.narrow #stage .modal{padding:16px}.narrow .mc-row3{grid-template-columns:1fr 1fr}.narrow .mc-date-field{grid-column:1/-1}.narrow .mc-time-panel-footer{flex-wrap:wrap}.narrow .mc-time-panel-footer>span{flex-basis:100%}
</style></head><body class="theme-light"><nav><button id="new">新建日程</button><button id="edit">重开已保存日程</button><button id="theme">切换深浅色</button><button id="narrow">切换窄屏</button><button id="tests">运行交互测试</button></nav><main id="stage"></main><div id="notice" role="status"></div><details open><summary>验证结果</summary><pre id="results">等待测试</pre><pre id="saved"></pre></details><script src="/preview.js"></script></body></html>`;
(async () => {
	const bundle = await esbuild.build({ entryPoints: [path.join(__dirname, 'modal-preview.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', alias: { obsidian: path.join(__dirname, 'preview-obsidian.ts') } });
	const baseCss = asset('app.css');
	const themeFile = path.resolve(root, '../.obsidian/themes/AnuPpuccin/theme.css');
	const server = http.createServer((req, res) => {
		const routes = {
			'/': ['text/html; charset=utf-8', () => html],
			'/preview.js': ['text/javascript; charset=utf-8', () => bundle.outputFiles[0].text],
			'/app.css': ['text/css', () => baseCss],
			'/theme.css': ['text/css', () => fs.existsSync(themeFile) ? fs.readFileSync(themeFile) : ''],
			'/styles.css': ['text/css', () => fs.readFileSync(path.join(root, 'styles.css'))],
		};
		const route = routes[req.url];
		if (!route) { res.writeHead(404); res.end(); return; }
		res.writeHead(200, { 'Content-Type': route[0], 'Cache-Control': 'no-store' }); res.end(route[1]());
	});
	server.listen(port, '127.0.0.1', () => console.log(`MyCalendar preview: http://127.0.0.1:${server.address().port} (in-memory data only)`));
})().catch(e => { console.error(e); process.exitCode = 1; });
