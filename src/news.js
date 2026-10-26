// The newspaper that slams onto the screen each time the kaiju grows, which is always right
// after a size boss falls. A silly front page about what it just did, that also spells out what
// it can crush now, what is coming for it, and the damage so far.
import { STAGES, STAGE_INFO } from './config.js';

// The paper gets more desperate with every edition.
const EDITIONS = [
  null,
  null,
  { name: 'Morning Edition', price: '50¢', note: 'All the news that is still standing' },
  { name: 'Special Edition', price: '75¢', note: 'Paper shortage: please share this copy' },
  { name: 'Emergency Edition', price: '$1', note: 'Now printed in a basement' },
  { name: 'Bunker Edition', price: '$5', note: 'Our offices were eaten' },
  { name: 'Final Edition', price: 'FREE', note: 'Honestly, what is money now' },
];

// Front pages for each new size, named for the boss that guarded it: [headline, subhead].
const HEADLINES = {
  2: [
    ['HITMAN HIT BACK', 'Cyborg agent "decommissioned" by a lizard the size of a minivan'],
    ['AGENT KILOWATT: UNPLUGGED', 'Creature now big enough to eat your car. Residents urged to park indoors'],
  ],
  3: [
    ['KAREN DEFEATED, MANAGER UNAVAILABLE', 'Beast grows to the size of a house. Several houses no longer the size of a house'],
    ['HOA PRESIDENT DEPOSED', 'Lawn violations soar as creature reaches the size of a house'],
  ],
  4: [
    ['MR. WHIPPY MELTS UNDER PRESSURE', 'Ice-cream tyrant eaten. Monster now as big as an apartment block'],
    ['THE JINGLE HAS STOPPED', 'Armoured ice-cream truck devoured. Monster reports brain freeze, keeps growing'],
  ],
  5: [
    ['WRECKING BILL CLOCKS OUT', 'Demolition crane out-demolished. Skyscrapers describe themselves as "nervous"'],
    ['BILL GETS THE BILL', 'Sentient crane outworked by a giant reptile. It now towers over office blocks'],
  ],
  6: [
    ['MAYOR VOTED OUT (BY BEING EATEN)', 'Creature now taller than the skyline. City Hall is "mostly a crater"'],
    ['CITY HALL FALLS', 'Monster now bigger than the city itself. Experts: "Well, that is not great"'],
  ],
};

// How big each size is, for the line over the headline.
const AS_BIG_AS = { 2: 'a backyard', 3: 'a house', 4: 'an apartment block', 5: 'an office tower', 6: 'the skyline' };

const CAPTIONS = [
  'Above: the suspect, moments before eating our photographer.',
  'Above: an artist’s impression. The artist has been eaten.',
  'Pictured: {k}, who declined to comment.',
  'Photo sent in by a reader. We would like our camera back.',
];

// Small print along the bottom: [section, joke].
const SIDEBAR = [
  ['Weather', 'Cloudy with a chance of debris.'],
  ['Traffic', 'All roads closed. Several roads missing.'],
  ['Real estate', 'Prices have gone flat. So have the houses.'],
  ['Sports', 'Home team forfeits after stadium found "too crunchy".'],
  ['Classifieds', 'LOST: one (1) skyscraper. Last seen falling over.'],
  ['Horoscope', 'Leo: avoid large green lizards today. And tomorrow.'],
  ['Insurance', '"Act of lizard" not covered, lawyers confirm.'],
  ['Opinion', 'Should we have built the city out of something less crunchy?'],
  ['Coupons', '50% off umbrellas. For the falling rubble.'],
  ['Letters', '"My car is now a pancake. Is that covered?" — Dave, 43'],
  ['Food', 'Monster rates city five stars: "Crunchy outside, chewy middle."'],
  ['Tech', 'New app shows where the monster is. It is behind you.'],
];
const FINAL_SIDEBAR = ['City Hall', 'Now hiring: Mayor. Must be chew-resistant.'];

// Who answers each new size, for the "Incoming" box (the top size faces the city's last hope).
function incoming(stage, city) {
  if (stage >= 6) return `The ${city.boss}. The city's last hope.`;
  return `${STAGE_INFO[stage].military}.`;
}

export function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)} billion`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e3) return `$${(Math.round(n / 1e3) * 1e3).toLocaleString('en-US')}`;
  return `$${Math.round(n)}`;
}

// The front page for growing into `stage`. rng: () => [0, 1), for picking among the jokes.
export function frontPage(game, stage, rng = Math.random) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const s = game.stats;
  const name = game.def.name;
  const [headline, subhead] = pick(HEADLINES[stage] || HEADLINES[2]);
  const ed = EDITIONS[stage] || EDITIONS[2];
  const jokes = [];
  const pool = SIDEBAR.slice();
  if (stage >= 6) jokes.push(FINAL_SIDEBAR);
  while (jokes.length < 3) jokes.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return {
    edition: `${ed.name} · No. ${stage - 1}`,
    price: ed.price,
    note: ed.note,
    city: game.cityDef.name,
    headline,
    subhead,
    size: `Size ${stage} · ${STAGES[stage].name} · as big as ${AS_BIG_AS[stage] || 'a building'}`,
    menu: `${STAGE_INFO[stage].destroys}.`,
    incoming: incoming(stage, game.cityDef),
    caption: pick(CAPTIONS).replace('{k}', name),
    damage: money(s.scrap || 0),
    numbers: [
      [Math.round(s.buildings || 0).toLocaleString('en-US'), 'buildings flattened'],
      [Math.round(s.people || 0).toLocaleString('en-US'), 'citizens eaten or flung'],
      [Math.round(s.cars || 0).toLocaleString('en-US'), 'cars pancaked'],
      [Math.round(s.units || 0).toLocaleString('en-US'), 'military units scrapped'],
    ],
    jokes,
  };
}
