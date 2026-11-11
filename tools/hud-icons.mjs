// Draws the in-run HUD's icons from ASCII art and writes them into styles.css, between the
// "hud-icons:begin" and "hud-icons:end" comments, as CSS variables of SVG data URIs (--hud-<name>).
// Each icon is drawn as its fill only; a one-pixel dark outline is added all the way round, so
// every icon has the same crisp edge on the HUD's dark plates and over the city. They are meant to
// be shown at exactly 2 screen pixels per art pixel, like the augment icons in the move tiles.
// Light comes from the top left: a highlight there, a shade down the right and along the bottom.
// Usage: node tools/hud-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTLINE = '#160d1c';
// One palette for every icon. '.' is empty; K is the outline colour used inside an icon.
const PALETTE = {
  K: OUTLINE,
  W: '#ffffff', w: '#e6e0f0', g: '#9d93b3',
  P: '#ffa3ad', R: '#ff4a5c', r: '#c0203a',
  H: '#fff1b0', Y: '#ffc93f', y: '#d38a1c', o: '#8c4f10',
  L: '#d8ffa6', G: '#7ddf4c', n: '#3a9a2c',
  B: '#f4efe2', b: '#bdb3a0',
};
// Arrow variants re-use the green arrow with other colours.
const RECOLOR = {
  gold: { L: '#fff1b0', G: '#ffc93f', n: '#c47f17' },
  red: { L: '#ffb0b8', G: '#ff4a5c', n: '#b81a34' },
};

const ICONS = {
  heart: [
    '............',
    '............',
    '..PPR..RRR..',
    '.PWPRRRRRRr.',
    '.PPRRRRRRRr.',
    '.RRRRRRRRRr.',
    '..RRRRRRRr..',
    '...RRRRRr...',
    '....RRrr....',
    '.....rr.....',
    '............',
    '............',
  ],
  coin: [
    '............',
    '....HHHH....',
    '...HHYYYy...',
    '..HYYoYYYy..',
    '.HYYoooYYyo.',
    '.HYYoYYYYyo.',
    '.HYYoooYYyo.',
    '.HYYYYoYYyo.',
    '..yYoooYYy..',
    '...yyoyyy...',
    '....oooo....',
    '............',
  ],
  sound: [
    '............',
    '............',
    '.....W......',
    '....WW...W..',
    '.WWWWW.W..W.',
    '.WWWWW..W.W.',
    '.WWWWW..W.W.',
    '.ggWWW.W..W.',
    '....gW...W..',
    '.....g......',
    '............',
    '............',
  ],
  mute: [
    '............',
    '............',
    '.....W......',
    '....WW......',
    '.WWWWW.R..R.',
    '.WWWWW..RR..',
    '.WWWWW..RR..',
    '.ggWWW.R..R.',
    '....gW......',
    '.....g......',
    '............',
    '............',
  ],
  pause: [
    '............',
    '............',
    '..WWW..WWW..',
    '..WWg..WWg..',
    '..WWg..WWg..',
    '..WWg..WWg..',
    '..WWg..WWg..',
    '..WWg..WWg..',
    '..WWg..WWg..',
    '..ggg..ggg..',
    '............',
    '............',
  ],
  clock: [
    '............',
    '....WWWW....',
    '...WWWWWW...',
    '..WWWKWWWg..',
    '.WWWWKWWWWg.',
    '.WWWWKKKWWg.',
    '.WWWWWWWWWg.',
    '.WWWWWWWWWg.',
    '..WWWWWWWg..',
    '...gWWWWg...',
    '....gggg....',
    '............',
  ],
  skull: [
    '............',
    '...BBBBBB...',
    '..BBBBBBBB..',
    '.BBBBBBBBBB.',
    '.BBKKBBKKBb.',
    '.BKKKBBKKKb.',
    '.BBKBBBBKBb.',
    '..bBBKKBBb..',
    '...BBBBBB...',
    '...BKBBKB...',
    '...bbbbbb...',
    '............',
  ],
  star: [
    '............',
    '............',
    '.....HY.....',
    '.....HY.....',
    '....HHYy....',
    '.HHHHYYYyyy.',
    '..HYYYYYYy..',
    '...YYYYYy...',
    '...YYYYYy...',
    '..YYY..yyy..',
    '..YY....yy..',
    '............',
  ],
  // The charge button's three moves: Rex pounces, Volt Beetle blinks, the others charge.
  claw: [
    '................',
    '................',
    '.W...W...W......',
    '.WW..WW..WW.....',
    '..WW..WW..WW....',
    '..WW..WW..WW....',
    '...WW..WW..WW...',
    '...WW..WW..WW...',
    '....WW..WW..WW..',
    '....WW..WW..WW..',
    '.....Wg..Wg..Wg.',
    '......g...g...g.',
    '................',
    '................',
    '................',
    '................',
  ],
  bolt: [
    '................',
    '........HHYY....',
    '.......HYYYy....',
    '......HYYYy.....',
    '.....HYYYy......',
    '....HYYYYYYYy...',
    '.....yyYYYYy....',
    '.......HYYy.....',
    '......HYYy......',
    '.....HYYy.......',
    '....HYy.........',
    '...Hy...........',
    '..y.............',
    '................',
    '................',
    '................',
  ],
  charge: [
    '................',
    '................',
    '................',
    '..WW....WW......',
    '...WW....WW.....',
    '....WW....WW....',
    '.....WW....WW...',
    '......WW....WW..',
    '.....Wg....Wg...',
    '....Wg....Wg....',
    '...Wg....Wg.....',
    '..gg....gg......',
    '................',
    '................',
    '................',
    '................',
  ],
  // Points the way to the next thing worth eating (green), a vault (gold) or the boss (red).
  arrow: [
    '................',
    '................',
    '........L.......',
    '........LL......',
    '........GLL.....',
    '........GGLL....',
    '.LLLLLLLGGGLL...',
    '.GGGGGGGGGGGGL..',
    '.GGGGGGGGGGGGn..',
    '.nnnnnnnGGGnn...',
    '........GGnn....',
    '........Gnn.....',
    '........nn......',
    '........n.......',
    '................',
    '................',
  ],
};

// Augment icons redrawn in the same way (the rest are hand-made in styles.css). They keep the
// augment icons' 11-pixel width and plum outline, so a move tile shows them at exactly 2x.
const AUG_OUTLINE = '#2a1736';
const AUG_COLORS = {
  E: '#ff8a3d', e: '#c4531c', C: '#a6ecff', M: '#cf6a3c', m: '#8a3a1e', N: '#f2a070',
};
const AUG_ICONS = {
  might: [
    '...........',
    '..HEE......',
    '.HEEEe.....',
    '.EEEEe.....',
    '..EEe......',
    '..EEe.HEE..',
    '..EEEEEEEe.',
    '..EEEEEEEe.',
    '...eeeeee..',
    '...........',
    '...........',
  ],
  spineMissiles: [
    '...........',
    '.........B.',
    '........Bb.',
    '.......BBb.',
    '......BBb..',
    '.....BBb...',
    '.w..BBb....',
    '...BBb.....',
    '.w.bbb.....',
    '...........',
    '...........',
  ],
  carToss: [
    '...........',
    '...........',
    '...PRRRr...',
    '..PCCRCCr..',
    '.PRRRRRRRr.',
    '.RRRRRRRRr.',
    '.rKKrrrKKr.',
    '..KK...KK..',
    '...........',
    '...........',
    '...........',
  ],
  laserEyes: [
    '...........',
    '...........',
    '..WWWW.....',
    '.WWYYWW....',
    '.WYKKYWPPP.',
    '.WYKKYWRRR.',
    '.gWYYWg....',
    '..gggg.....',
    '...........',
    '...........',
    '...........',
  ],
  atomicBreath: [
    '...........',
    '.........G.',
    '.......GLG.',
    '.....GGLLG.',
    '...GGLLWLG.',
    '.LLWWWWWLG.',
    '...nGLLWLn.',
    '.....nGLLn.',
    '.......nGn.',
    '.........n.',
    '...........',
  ],
  bigBones: [
    '...........',
    '...........',
    '...........',
    '.BB.....BB.',
    '.BBBBBBBBb.',
    '.bBbbbbbbb.',
    '.bb.....bb.',
    '...........',
    '...........',
    '...........',
    '...........',
  ],
  appetite: [
    '...........',
    '..NNMM.....',
    '.NNMMMMm...',
    '.NMMMMMm...',
    '.MMMMMMm...',
    '..mMMMmm...',
    '...mmmBB...',
    '......BBB..',
    '......BbBB.',
    '.......bb..',
    '...........',
  ],
};

// The fill, plus the outline on every empty pixel touching it (sideways or corner to corner).
function withOutline(rows, outline = 'K') {
  const h = rows.length;
  const w = rows[0].length;
  const grid = rows.map((r) => r.split(''));
  const filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rows[y][x] !== '.';
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`row ${y} is ${rows[y].length} wide, not ${w}`);
    for (let x = 0; x < w; x++) {
      if (filled(x, y)) {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) throw new Error('fill touches the edge: no room for the outline');
        continue;
      }
      for (let dy = -1; dy <= 1 && grid[y][x] === '.'; dy++) for (let dx = -1; dx <= 1; dx++) if (filled(x + dx, y + dy)) grid[y][x] = outline;
    }
  }
  return grid.map((r) => r.join(''));
}

function svg(rows, colors) {
  const w = rows[0].length;
  const h = rows.length;
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < w;) {
      const ch = row[x];
      let n = 1;
      while (x + n < w && row[x + n] === ch) n++;
      if (ch !== '.') {
        const c = colors[ch];
        if (!c) throw new Error(`no colour for '${ch}'`);
        rects += `<rect x='${x}' y='${y}' width='${n}' height='1' fill='${c.replace('#', '%23')}'/>`;
      }
      x += n;
    }
  });
  return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' shape-rendering='crispEdges'>${rects}</svg>")`;
}

export function augIcons() {
  const out = {};
  const colors = { ...PALETTE, ...AUG_COLORS, K: AUG_OUTLINE, Q: AUG_OUTLINE };
  for (const [id, rows] of Object.entries(AUG_ICONS)) out[id] = svg(withOutline(rows, 'Q'), colors);
  return out;
}

export function hudIcons() {
  const out = {};
  for (const [name, rows] of Object.entries(ICONS)) out[name] = svg(withOutline(rows), PALETTE);
  for (const [name, swap] of Object.entries(RECOLOR)) out[`arrow-${name}`] = svg(withOutline(ICONS.arrow), { ...PALETTE, ...swap });
  return out;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = join(root, 'styles.css');
  const css = readFileSync(path, 'utf8');
  const begin = '/* hud-icons:begin (generated by tools/hud-icons.mjs) */';
  const end = '/* hud-icons:end */';
  const icons = hudIcons();
  const block = `${begin}\n${Object.entries(icons).map(([name, url]) => `  --hud-${name}: ${url};`).join('\n')}\n  ${end}`;
  const a = css.indexOf(begin);
  const b = css.indexOf(end);
  if (a < 0 || b < 0) throw new Error('styles.css has no hud-icons:begin/hud-icons:end block');
  let out = css.slice(0, a) + block + css.slice(b + end.length);
  // The redrawn augment icons, as .ico-<id> rules after the hand-made ones (so they take over).
  const augBegin = '/* aug-icons:begin (generated by tools/hud-icons.mjs) */';
  const augEnd = '/* aug-icons:end */';
  const aug = augIcons();
  const augBlock = `${augBegin}\n${Object.entries(aug).map(([id, url]) => `.ico-${id} { background-image: ${url}; }`).join('\n')}\n${augEnd}`;
  const c = out.indexOf(augBegin);
  const d = out.indexOf(augEnd);
  if (c < 0 || d < 0) throw new Error('styles.css has no aug-icons:begin/aug-icons:end block');
  out = out.slice(0, c) + augBlock + out.slice(d + augEnd.length);
  writeFileSync(path, out);
  console.log(`wrote ${Object.keys(icons).length} HUD icons and ${Object.keys(aug).length} augment icons`);
}
