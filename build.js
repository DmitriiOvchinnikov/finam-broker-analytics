// Сборка dist/index.html из src/index.html: сжатие кода, версия и дата сборки, контрольная сумма SHA-256.
//   node build.js            — собрать
//   node build.js --check    — собрать и проверить, что собранный разборщик разбирает справки из ./samples (если есть)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { minify } = require('terser');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const ORIGIN = (pkg.homepage || '').trim();
const BUILT = new Date().toISOString().slice(0, 10).split('-').reverse().join('.');
const BANNER = `Брокерская аналитика ФИНАМ · © 2026 Дмитрий Овчинников (t.me/Dmitrii_Ovchinnikov) · CC BY-NC-ND 4.0 · версия ${VERSION}`;

async function build() {
  let html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8')
    .replaceAll('__APP_VERSION__', VERSION).replaceAll('__BUILD_DATE__', BUILT).replaceAll('__ORIGIN_URL__', ORIGIN);

  const terserOpts = (toplevel) => ({
    ecma: 2020, toplevel, compress: { passes: 2 }, mangle: { toplevel },
    format: { comments: /^!/, ascii_only: false },
  });
  // разборщик: верхний уровень не сжимаем — страница вызывает parseReport() и ищет PARSER_VERSION
  html = await replaceAsync(html, /(<script type="text\/plain" id="parserSrc">)([\s\S]*?)(<\/script>)/, async (m, a, code, b) =>
    a + (await minify(code, terserOpts(false))).code + b);
  // основной скрипт: всё внутреннее можно переименовать
  html = await replaceAsync(html, /(<script>)(\s*\/\*![\s\S]*?)(<\/script>\s*<\/body>)/, async (m, a, code, b) =>
    a + (await minify(code, terserOpts(true))).code + b);
  // стили и разметка: убрать отступы и комментарии (кроме строки об авторстве)
  html = html.replace(/<style>([\s\S]*?)<\/style>/, (m, css) => '<style>/*! ' + BANNER + ' */' +
    css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').trim() + '</style>');
  // разметку сжимаем только вне скриптов: внутри них HTML-шаблоны в строках, пробелы там значимы
  html = html.split(/(<script[\s\S]*?<\/script>)/).map((part, i) => i % 2 ? part :
    part.replace(/<!--(?![^]*?Дмитрий)[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\n\s*\n/g, '\n')).join('');

  html = html.replace(/\r\n?/g, '\n');   // одинаковые переводы строк: иначе git или редактор поменяют байты и контрольную сумму
  const outDir = path.join(__dirname, 'dist'); fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'index.html');
  fs.writeFileSync(out, html, 'utf8');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), `${sha}  index.html\n`, 'utf8');
  console.log(`dist/index.html  версия ${VERSION}  ${(html.length / 1024).toFixed(0)} КБ\nSHA-256: ${sha}`);
  return out;
}
async function replaceAsync(str, re, fn) {
  const m = re.exec(str); if (!m) throw new Error('не найден блок ' + re);
  return str.slice(0, m.index) + await fn(...m) + str.slice(m.index + m[0].length);
}
build().then(out => {
  if (!process.argv.includes('--check')) return;
  const html = fs.readFileSync(out, 'utf8');
  const parser = /id="parserSrc">([\s\S]*?)<\/script>/.exec(html)[1];
  const parse = new Function(parser + ';return parseReport;')();
  const dir = path.join(__dirname, 'samples');
  if (!fs.existsSync(dir)) { console.log('проверка: папки samples нет — пропущено'); return; }
  for (const f of fs.readdirSync(dir)) {
    try { const r = parse(fs.readFileSync(path.join(dir, f), 'utf8')); console.log('ок   ', f, r.account, r.date); }
    catch (e) { console.log('отказ', f, e.code || e.message); }
  }
}).catch(e => { console.error(e); process.exit(1); });
