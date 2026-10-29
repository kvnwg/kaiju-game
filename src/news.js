// The newspaper that slams onto the screen each time the kaiju grows, which is always right
// after a size boss falls. A silly front page about what it just did, that also spells out what
// it can crush now, what is coming for it, and the damage so far.
import { STAGES, STAGE_INFO, REALMS } from './config.js';
import { MONEY_NAMES, moneyScale } from './prices.js';

// The paper gets more desperate with every edition.
const EDITIONS = [
  null,
  null,
  { name: 'Morning Edition', price: '50¢', note: 'All the news that is still standing' },
  { name: 'Special Edition', price: '75¢', note: 'Paper shortage: please share this copy' },
  { name: 'Emergency Edition', price: '$1', note: 'Now printed in a basement' },
  { name: 'Bunker Edition', price: '$5', note: 'Our offices were eaten' },
  { name: 'Final Edition', price: 'FREE', note: 'Honestly, what is money now' },
  { name: 'Orbital Edition', price: '1 moon rock', note: 'Printed on the last satellite' },
  { name: 'Interstellar Edition', price: '3 stars', note: 'Delivered at light speed. Arrives in four years' },
  { name: 'Multiversal Edition', price: 'Priceless', note: 'Available in every universe, while they last' },
  { name: 'Morning Dew Edition', price: '1 crumb', note: 'All the news that fits on a leaf' },
  { name: 'Colony Edition', price: '2 crumbs', note: 'Now printed on a bigger leaf' },
];
// Back at the start, the next time round.
const LOOP_EDITION = { name: 'Second Printing', price: '50¢', note: 'Haven’t we done this before?' };

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
  7: [
    ['MONSTER LEAVES EARTH. EARTH RELIEVED', 'Coast Guard Mech defeated. Creature now the size of a planet. The Moon reportedly "nervous"'],
    ['ONE SMALL STEP FOR LIZARD', 'Beast outgrows the planet and wanders off into space, still hungry'],
  ],
  8: [
    ['FEDERATION ADMIRAL EATEN', 'Creature now the size of a galaxy. Stars advised to stay indoors'],
    ['ZORBLAX DEMOTED (TO LUNCH)', 'Galactic Federation "reviewing its options". Monster now bigger than most galaxies'],
  ],
  9: [
    ['IT WAS NOT A MOON', 'Battle station devoured. Monster outgrows the galaxy, starts eyeing whole universes'],
    ['THAT WAS NO MOON. NOW IT IS NO MOON', 'Creature now the size of a universe. Physicists request a long lie-down'],
  ],
  10: [
    ['GIANT MONSTER LANDS IN GARDEN. IS VERY SMALL', 'Tiny lizard claims to have "eaten the multiverse". Ant colony unconvinced'],
    ['WHOLE MULTIVERSE "JUST A DEWDROP"', 'Cosmic janitor swept up. Creature falls out of a dewdrop onto a lawn, ant-sized and furious'],
  ],
  11: [
    ['QUEEN DEPOSED', 'The colony mourns. Creature now the size of a mini shrub, and the shrubs know it'],
    ['LONG LIVE THE... OH NO', 'Ant Queen eaten. Garden gnomes report "a bad feeling about this"'],
  ],
};
const LOOP_HEADLINES = [
  ['IT’S BACK', 'Tiny lizard climbs out of a flower bed claiming it ate the universe. Experts: "That is just a lizard"'],
  ['HERE WE GO AGAIN', 'Lawnmower defeated. Creature seen leaving a garden, human-sized, and smelling faintly of galaxies'],
];

// How big each size is, for the line over the headline.
const AS_BIG_AS = {
  1: 'a person', 2: 'a backyard', 3: 'a house', 4: 'an apartment block', 5: 'an office tower', 6: 'the skyline',
  7: 'a planet', 8: 'a galaxy', 9: 'a universe', 10: 'an ant', 11: 'a mini shrub',
};
// Each realm has its own paper.
const MASTHEAD = { city: 'The Daily Stomp', solar: 'The Galactic Gazette', galaxy: 'The Galactic Gazette', cosmos: 'The Galactic Gazette', garden: 'The Anthill Herald' };

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
const SPACE_SIDEBAR = [
  ['Weather', 'Solar wind, with a chance of being eaten.'],
  ['Astrology', 'Your stars are gone. Something ate them.'],
  ['Real estate', 'Planets going cheap. Some assembly required.'],
  ['Traffic', 'Asteroid belt closed. Belt missing.'],
  ['Science', 'Black hole reports it has "finally met its match".'],
  ['Classifieds', 'LOST: one (1) moon. Answers to "Moon".'],
  ['Opinion', 'Should we have made the universe out of something less crunchy?'],
  ['Tourism', 'Visit the Milky Way! (While it lasts.)'],
];
const GARDEN_SIDEBAR = [
  ['Weather', 'Morning dew. Chance of being stepped on.'],
  ['Real estate', 'Anthill prices crash after "the incident".'],
  ['Food', 'Crumb supply at record low. Monster blamed.'],
  ['Sports', 'Beetle races cancelled. Beetles eaten.'],
  ['Classifieds', 'LOST: one (1) mushroom. Last seen being eaten.'],
  ['Gardening', 'The lawnmower is coming. Mow your expectations.'],
  ['Science', 'Monster insists our garden "is a universe". Ants laugh.'],
];

// Who answers each new size, for the "Incoming" box (the top size faces the city's last hope).
function incoming(stage, city, loop) {
  if (stage === 6) return `The ${city.boss}. The city's last hope.`;
  if (stage === 1 && loop > 1) return 'Cops on foot. Again.';
  return `${STAGE_INFO[stage].military}.`;
}

export function money(n) {
  if (n >= 1e6) {
    const [v, i] = moneyScale(n);
    return `$${v.toFixed(1)} ${MONEY_NAMES[i][1]}`;
  }
  if (n >= 1e3) return `$${(Math.round(n / 1e3) * 1e3).toLocaleString('en-US')}`;
  return `$${Math.round(n)}`;
}

// The front page for growing into `stage`. rng: () => [0, 1), for picking among the jokes.
export function frontPage(game, stage, rng = Math.random) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const s = game.stats;
  const name = game.def.name;
  const realm = game.realm || 'city';
  const loop = game.loop || 1;
  const again = stage === 1 && loop > 1;
  const [headline, subhead] = pick(again ? LOOP_HEADLINES : HEADLINES[stage] || HEADLINES[2]);
  const ed = again ? LOOP_EDITION : EDITIONS[stage] || EDITIONS[2];
  const space = Boolean(REALMS[realm] && REALMS[realm].space);
  const jokes = [];
  const pool = (space ? SPACE_SIDEBAR : realm === 'garden' ? GARDEN_SIDEBAR : SIDEBAR).slice();
  if (stage === 6) jokes.push(FINAL_SIDEBAR);
  while (jokes.length < 3) jokes.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const n = (v) => Math.round(v || 0).toLocaleString('en-US');
  return {
    mast: MASTHEAD[realm] || MASTHEAD.city,
    edition: `${ed.name} · No. ${again ? `${loop}-1` : stage - 1}`,
    price: ed.price,
    note: ed.note,
    city: realm === 'city' ? game.cityDef.name : REALMS[realm].name,
    headline,
    subhead,
    size: `Size ${stage} · ${STAGES[stage].name} · as big as ${AS_BIG_AS[stage] || 'a building'}`,
    menu: `${STAGE_INFO[stage].destroys}.`,
    incoming: incoming(stage, game.cityDef, loop),
    caption: pick(CAPTIONS).replace('{k}', name),
    damage: money(s.damage || 0),
    numbers: [
      [n(s.buildings), space ? 'worlds and buildings flattened' : 'buildings flattened'],
      [n(s.people), realm === 'garden' ? 'citizens and ants eaten' : 'citizens eaten or flung'],
      [n(s.cars), 'cars pancaked'],
      [n(s.units), space ? 'armies and starships scrapped' : 'military units scrapped'],
    ],
    jokes,
  };
}
