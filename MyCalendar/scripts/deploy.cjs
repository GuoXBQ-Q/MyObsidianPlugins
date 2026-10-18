const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const target = path.resolve(root, '../.obsidian/plugins/my-calendar');

execFileSync(process.execPath, [path.join(root, 'esbuild.config.mjs'), 'production'], {
  cwd: root,
  stdio: 'inherit',
});

fs.mkdirSync(target, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  fs.copyFileSync(path.join(root, 'build', name), path.join(target, name));
}
console.log('Installed ' + target + ' (reload MyCalendar in Obsidian to load the new build).');
