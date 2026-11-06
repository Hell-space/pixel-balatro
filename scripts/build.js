// Assemble the portable game. The order reflects the shared classic-script runtime.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const modules = ['audio', 'cards', 'game', 'table', 'score-engine', 'scoring', 'shop', 'guide', 'multiplayer', 'session', 'controls', 'collection'];
const css = ['table', 'layout'].map(name => read('src/' + name + '.css')).join('\n\n');
const js = modules.map(name => '// ── ' + name + ' ──\n' + read('src/js/' + name + '.js')).join('\n\n');
const html = read('src/page.html').replace('/* STYLES */', () => css)
  .replace('<!-- ART -->', () => read('src/jester.svg'))
  .replace('/* SCRIPTS */', () => js) + '\n';
const target = path.join(root, 'balatro.html');
if (process.argv.includes('--check')) {
  if (read('balatro.html') !== html.trimEnd()) {
    console.error('balatro.html 与源码不一致，请运行 npm run build。');
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(target, html);
  console.log('已生成 balatro.html（' + Buffer.byteLength(html) + ' 字节）');
}
