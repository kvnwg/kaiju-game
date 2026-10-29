// Builds the release in dist/: the page, one minified game script, three.js, the stylesheet with
// the fonts, the title art, all on relative paths, plus dist/kaiju-rampage.zip with index.html at its root, ready
// to upload to CrazyGames. Usage: npm run build
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const read = (p) => readFileSync(join(root, p), 'utf8');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });
mkdirSync(join(out, 'licenses'), { recursive: true });

// The game: every module in one minified script.
await build({
  entryPoints: [join(root, 'src/main.js')], bundle: true, minify: true, format: 'iife', target: 'es2019',
  outfile: join(out, 'game.js'), legalComments: 'none', logLevel: 'warning',
});

// three.js as published, and its post-processing scripts (plain scripts that add to window.THREE) minified into one.
let page = read('index.html');
const extras = [...page.matchAll(/<script src="vendor\/three\/([^"]+)"><\/script>\n/g)].map((m) => m[1]).filter((f) => f !== 'three.min.js');
copyFileSync(join(root, 'vendor/three/three.min.js'), join(out, 'three.min.js'));
const extrasJs = await transform(extras.map((f) => read(`vendor/three/${f}`)).join(';\n'), { minify: true, loader: 'js' });
writeFileSync(join(out, 'three-extras.js'), extrasJs.code);
copyFileSync(join(root, 'vendor/three/LICENSE'), join(out, 'licenses/three.js.txt'));

// One stylesheet: the fonts, then the game's styles.
const fontsCss = read('vendor/fonts/fonts.css').replace(/url\(([^)]+\.woff2)\)/g, 'url(fonts/$1)');
const css = await transform(`${fontsCss}\n${read('styles.css')}`, { minify: true, loader: 'css' });
writeFileSync(join(out, 'styles.css'), css.code);
for (const f of readdirSync(join(root, 'vendor/fonts'))) {
  if (f.endsWith('.woff2')) copyFileSync(join(root, 'vendor/fonts', f), join(out, 'fonts', f));
  if (f.startsWith('OFL-')) copyFileSync(join(root, 'vendor/fonts', f), join(out, 'licenses', f));
}

// The title art (rendered by tools/title-art.mjs), on the same relative paths as in styles.css.
mkdirSync(join(out, 'art'), { recursive: true });
for (const f of readdirSync(join(root, 'art'))) if (f.endsWith('.jpg')) copyFileSync(join(root, 'art', f), join(out, 'art', f));

// The page: marked as a release (no debug keys), pointing at the files above.
const swap = (from, to) => {
  if (!page.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  page = page.replace(from, to);
};
swap('<html lang="en">', '<html lang="en" data-release>');
swap('  <link rel="stylesheet" href="vendor/fonts/fonts.css">\n', '');
page = page.replace(/  <script src="vendor\/three\/[^"]+"><\/script>\n/g, '');
swap('  <script type="module" src="src/main.js"></script>', '  <script src="three.min.js"></script>\n  <script src="three-extras.js"></script>\n  <script src="game.js"></script>');
writeFileSync(join(out, 'index.html'), page);

// The upload: everything in dist/, index.html at the zip's root.
const files = readdirSync(out, { recursive: true }).filter((f) => statSync(join(out, f)).isFile());
const size = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
try {
  execFileSync('zip', ['-q', '-r', '-X', 'kaiju-rampage.zip', ...files], { cwd: out });
  console.log(`dist/: ${files.length} files, ${(size / 1024).toFixed(0)} KB; dist/kaiju-rampage.zip: ${(statSync(join(out, 'kaiju-rampage.zip')).size / 1024).toFixed(0)} KB`);
} catch (err) {
  console.log(`dist/: ${files.length} files, ${(size / 1024).toFixed(0)} KB (no zip command here: zip the contents of dist/ yourself)`);
}
