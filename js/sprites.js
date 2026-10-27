// Procedural pixel-art sprites (16×16 logical pixels) and the NES palette.
// Each sprite is an array of 16 strings; every character maps to a palette
// color ('.' = transparent). Sprites are rasterized once into small canvases.

// Subset of the NES (2C02) palette used across the game.
export const NES = {
  black: '#000000',
  white: '#FCFCFC',
  gray: '#7C7C7C',
  lightGray: '#BCBCBC',
  darkBlue: '#0000BC',
  blue: '#0058F8',
  midBlue: '#0078F8',
  lightBlue: '#3CBCFC',
  paleBlue: '#A4E4FC',
  red: '#F83800',
  darkRed: '#A80020',
  orange: '#FCA044',
  darkOrange: '#E45C10',
  yellow: '#F8B800',
  brown: '#AC7C00',
  skin: '#FCE0A8',
  tan: '#F0D0B0',
  green: '#00A800',
  lightGreen: '#58F898',
  lime: '#B8F818',
  pink: '#F878F8',
  cyan: '#00E8D8',
  lavender: '#6888FC',
};

export const TILE_PX = 16;

// ---------------------------------------------------------------------------
// Robber (player): beanie, black eye mask, striped shirt, money bag.
// Upper body (rows 0–12) + leg frames (rows 13–15) are combined per frame.

const ROBBER_COLORS = {
  H: NES.red,      // beanie
  S: NES.skin,
  K: NES.black,    // mask / stripes
  W: NES.white,    // eyes / stripes
  P: NES.midBlue,  // pants
  O: NES.brown,    // shoes
  T: NES.brown,    // bag outline
  Y: NES.tan,      // bag
  G: NES.green,    // "$" on the bag
};

const ROBBER_SIDE_TOP = [
  '......HHHH......',
  '.....HHHHHH.....',
  '.....HHHHHHH....',
  '.....SSSSSSS....',
  '.....KKKWKKW....',
  '.....SSSSSSS....',
  '......SSSSS.....',
  '.TTT.WWWWWW.....',
  'TYYYTKKKKKKS....',
  'TYGYTWWWWWWS....',
  'TYYYTKKKKKK.....',
  '.TTT.WWWWWW.....',
  '......PPPPP.....',
];
const ROBBER_SIDE_LEGS = [
  ['.....PP...PP....', '....PP.....PP...', '...OOO......OOO.'], // stride
  ['......PP.PP.....', '......PP.PP.....', '......OOO.OOO...'], // passing
  ['......PPPP......', '.......PP.......', '.......OOO......'], // crossed
];

const ROBBER_FRONT_TOP = [
  '......HHHH......',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....SSSSSSSS....',
  '....KWWKKWWK....',
  '....SSSSSSSS....',
  '.....SSSSSS.....',
  '....WWWWWWWW....',
  '...SKKKKKKKKS...',
  '...SWWWWWWWWSTT.',
  '....KKKKKKKKTYYT',
  '....WWWWWWWWTGYT',
  '.....PPPPPP..TT.',
];
const ROBBER_BACK_TOP = [
  '......HHHH......',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HHHHHHHH....',
  '....KKKKKKKK....',
  '....SSSSSSSS....',
  '.....SSSSSS.....',
  '....WWWWWWWW....',
  '.TTSKKKKKKKKS...',
  'TYYTWWWWWWWWS...',
  'TGYTKKKKKKKK....',
  'TYYTWWWWWWWW....',
  '.TT..PPPPPP.....',
];
const ROBBER_FRONT_LEGS = [
  ['.....PP..PP.....', '.....PP..PP.....', '....OOO..OOO....'], // standing
  ['.....PP..PP.....', '.....PP..OO.....', '....OOO.........'], // right foot up
  ['.....PP..PP.....', '.....OO..PP.....', '.........OOO....'], // left foot up
];

// Walk cycle: indices into the leg frames above.
export const WALK_CYCLE = [0, 1, 0, 2];

// ---------------------------------------------------------------------------
// Cop: blue uniform and cap. 'A' = per-AI accent (cap band + badge),
// 'L' = siren light (red/blue blinking).

const COP_TOP = [
  '................',
  '......LLLL......',
  '.....CCCCCC.....',
  '....CCCCCCCC....',
  '....AAAAAAAA....',
  '...VVVVVVVVVV...',
  '....SSSSSSSS....',
  '....SKSSSSKS....',
  '....SSSSSSSS....',
  '.....SSSSSS.....',
  '...UUUUUUUUUU...',
  '..UUUUUUUUAUUU..',
  '..SUUUUUUUUUUS..',
  '....NNNNNNNN....',
];
const COP_LEGS = [
  ['....NN....NN....', '...GGG....GGG...'],
  ['.....NN..NN.....', '....GGG..GGG....'],
];

// Accent color per AI type (index = type order in game.js).
export const COP_ACCENTS = {
  chaser: NES.red,
  ambusher: NES.pink,
  flanker: NES.cyan,
  wanderer: NES.orange,
};
export const SIREN_COLORS = [NES.red, NES.lightBlue];

// Spawn telegraph: a lone siren light on a small base.
const TELEGRAPH = [
  '................',
  '................',
  '................',
  '................',
  '......LLLL......',
  '.....LLWLLL.....',
  '.....LLLLLL.....',
  '.....LLLLLL.....',
  '....GGGGGGGG....',
  '....GGGGGGGG....',
];

// ---------------------------------------------------------------------------

/** Rasterize a sprite (array of strings) into a 16×16 canvas. */
export function buildSprite(rows, colors, flip = false) {
  const c = document.createElement('canvas');
  c.width = TILE_PX;
  c.height = TILE_PX;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    const r = row.padEnd(TILE_PX, '.');
    for (let x = 0; x < TILE_PX; x++) {
      const ch = r[flip ? TILE_PX - 1 - x : x];
      const col = colors[ch];
      if (ch === '.' || !col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

/** Build every sprite variant used by the renderer. */
export function buildAllSprites() {
  const robber = { right: [], left: [], down: [], up: [] };
  for (let i = 0; i < 3; i++) {
    const side = ROBBER_SIDE_TOP.concat(ROBBER_SIDE_LEGS[i]);
    robber.right.push(buildSprite(side, ROBBER_COLORS));
    robber.left.push(buildSprite(side, ROBBER_COLORS, true));
    robber.down.push(buildSprite(ROBBER_FRONT_TOP.concat(ROBBER_FRONT_LEGS[i]), ROBBER_COLORS));
    robber.up.push(buildSprite(ROBBER_BACK_TOP.concat(ROBBER_FRONT_LEGS[i]), ROBBER_COLORS));
  }

  // cop[type][sirenPhase][legFrame]
  const cop = {};
  for (const [type, accent] of Object.entries(COP_ACCENTS)) {
    cop[type] = SIREN_COLORS.map((siren) =>
      COP_LEGS.map((legs) =>
        buildSprite(COP_TOP.concat(legs), {
          C: NES.blue, V: NES.darkBlue, U: NES.midBlue, N: NES.darkBlue,
          S: NES.skin, K: NES.black, G: NES.gray, A: accent, L: siren,
        }),
      ),
    );
  }

  const telegraph = SIREN_COLORS.map((siren) =>
    buildSprite(TELEGRAPH, { L: siren, W: NES.white, G: NES.gray }),
  );

  return { robber, cop, telegraph };
}
