// Points of interest: places out in the country that do something when you
// reach them. This module is the rules only: where each one stands, what kind
// it is, and what it gives. No scene in here, so it can be tested on its own.
import { regionAt } from './regions.js';
import { seededRandom } from './models/wilderness.js';
import { dungeonsNear } from './dungeon.js';
import { LEGEND_LIST, lairFor } from './legends.js';
import { landmarksNear } from './components/exploration.js';

export const POI_SPACING = 160;      // One cell of country, and at most one place in it.
export const HOME_CLEAR = 130;       // Nothing procedural this close to the clearing.
export const DISCOVER_RADIUS = 14;   // Walk this close and it goes on your map.
export const USE_RADIUS = 6;         // Stand this close to use it.
export const SURVEY_RADIUS = 320;    // How far a watchtower lets you see.
export const SURVEY_SITE_RADIUS = 160; // Landmarks are small: you only make out the near ones.
export const DEN_WAKE_RADIUS = 34;   // Come this close and a den's owners come out.
export const DEN_REFILL_DAYS = 4;    // A cleared den is lived in again after this long.
export const WAYSTONE_MIN = 260;     // No procedural waystone nearer home than this.
export const ELITE_LEVEL = 3;        // Dens this far out are led by an elite.

// The first layer: one of these in most 160 m squares.
export const POI_KINDS = Object.freeze({
    tower: {label: 'Watchtower', plural: 'Watchtowers', weight: .2},
    waystone: {label: 'Waystone', plural: 'Waystones', weight: .2},
    den: {label: 'Den', plural: 'Dens', weight: .32},
    haven: {label: 'Haven', plural: 'Havens', weight: .28}
});

// Who lives in a den, by region, and what they were sitting on.
export const DENS = Object.freeze({
    meadow: {name: 'Boar wallow', kind: 'boar', count: 3, spoils: {rawMeat: 2, pelt: 1}},
    tundra: {name: 'Ice wolf den', kind: 'icewolf', count: 3, spoils: {pelt: 2, rawMeat: 1}},
    desert: {name: 'Scorpion nest', kind: 'scorpion', count: 3, spoils: {ironOre: 2, cactusFruit: 2}},
    marsh: {name: 'Toad hollow', kind: 'toad', count: 3, spoils: {mushrooms: 3, herbs: 2}}
});

// A haven answers whatever its region takes from you. `cold` and `thirst` set
// the need outright; `hunger` and `heal` add; `water` fills a waterskin.
export const HAVENS = Object.freeze({
    meadow: {name: 'Old orchard', verb: 'pick the fruit', done: 'Fruit picked',
        effect: {hunger: 20, items: {berries: 4}}},
    tundra: {name: 'Hot spring', verb: 'soak in the spring', done: 'Warmed through',
        effect: {cold: 0, heal: 30, buff: 'warmth'}},
    desert: {name: 'Oasis', verb: 'drink deep', done: 'Thirst gone',
        effect: {thirst: 100, water: true, heal: 10}},
    marsh: {name: 'Stilt hut', verb: 'rest a while', done: 'Rested',
        effect: {cure: true, heal: 20, buff: 'antivenom', items: {herbs: 2, mushrooms: 2}}}
});

// The second layer, on a wider grid of its own so that adding it moved none
// of the first: a trader, a shrine or a cairn. Wrecks lie in the lakes.
export const EXTRA_SPACING = 220;
export const EXTRA_HOME_CLEAR = 170;
export const EXTRA_KINDS = Object.freeze({
    trader: {label: 'Trader', plural: 'Traders', weight: .3},
    shrine: {label: 'Shrine', plural: 'Shrines', weight: .3},
    cairn: {label: 'Cairn', plural: 'Cairns', weight: .4}
});
export const WRECK_KIND = Object.freeze({label: 'Wreck', plural: 'Wrecks'});
export const KIND_LABELS = Object.freeze({...POI_KINDS, ...EXTRA_KINDS, wreck: WRECK_KIND});

// A shrine is to one of three beasts, and lends you what that beast has.
export const SHRINES = Object.freeze({
    fury: {name: 'Shrine of the Boar', gift: 'the boar lends you its fury'},
    stoneskin: {name: 'Shrine of the Tortoise', gift: 'the tortoise lends you its shell'},
    haste: {name: 'Shrine of the Hare', gift: 'the hare lends you its legs'}
});
export const SHRINE_SECONDS = 240;   // Twice what a dungeon shrine gives: you have further to walk.

// What things are worth to a trader, in the same made-up unit.
export const WORTH = Object.freeze({wood: 1, stone: 1, fiber: 1.5, berries: 1.5, planks: 2.5, herbs: 2.5, arrows: 1.5, mushrooms: 3,
    cactusFruit: 3, rawMeat: 4, fish: 5, ironOre: 5, torch: 5, cookedMeat: 6, pelt: 7, iron: 12});
export const TRADE_MARGIN = 1.3;     // A trader takes about a third more than they give.
export const TRADE_STOCK = 2;        // Each line can be had this many times a day.
export const GEAR_PRICE = 30;        // What a piece of gear costs near home, in the same unit.
// What a trader in each region is short of, and what they have to spare.
export const WANTS = {
    meadow: ['pelt', 'fish', 'ironOre', 'rawMeat', 'stone'], tundra: ['wood', 'berries', 'herbs', 'fish', 'fiber'],
    desert: ['fish', 'wood', 'berries', 'mushrooms', 'pelt'], marsh: ['stone', 'ironOre', 'cactusFruit', 'pelt', 'wood']
};
const SELLS = {
    meadow: ['arrows', 'planks', 'iron', 'torch'], tundra: ['pelt', 'cookedMeat', 'arrows', 'iron'],
    desert: ['cactusFruit', 'ironOre', 'arrows', 'torch'], marsh: ['mushrooms', 'herbs', 'arrows', 'iron']
};
const LOTS = {arrows: 8, planks: 6, iron: 2, torch: 2, pelt: 2, cookedMeat: 2, cactusFruit: 4, ironOre: 3, mushrooms: 4, herbs: 4};

const KEEPERS = ['Maren', 'Tobin', 'Hesk', 'Orla', 'Brannoch', 'Isolde', 'Wend', 'Garrick', 'Sefa', 'Dunmore', 'Yarrow', 'Petra'];
const SHIPS = ['Heron', 'Marigold', 'Lantern', 'Grey Goose', 'Thistle', 'Wayfarer', 'Kingfisher', 'Sparrow', 'Otter', 'Longreach'];

const TOWER_NAMES = ['Ashen', 'Briar', 'Crow', 'Dawn', 'Elder', 'Fallow', 'Gale', 'Heron', 'Iron', 'Kestrel', 'Lone', 'Marten'];
const STONE_NAMES = ['Alder', 'Bracken', 'Cinder', 'Drift', 'Ember', 'Fen', 'Gorse', 'Hazel', 'Ivy', 'Juniper', 'Linden', 'Moss',
    'Nettle', 'Osier', 'Pine', 'Rowan', 'Sedge', 'Thorn', 'Vetch', 'Yarrow'];

// Two places you are shown on the way out of the clearing: a waystone to come
// home to, and a tower that shows you what else is about.
export const STARTER_POIS = Object.freeze([
    Object.freeze({id: 'poi:home', kind: 'waystone', region: 'meadow', name: 'Clearing Waystone', x: -22, z: 24, level: 1}),
    Object.freeze({id: 'poi:lookout', kind: 'tower', region: 'meadow', name: 'Greenwood Lookout', x: 84, z: 66, level: 1})
]);

const hash = (a, b, salt) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ salt) | 0;
const isLake = (x, z) => Math.sin(x * .005) * Math.cos(z * .005) > .56;
const pick = (list, random) => list[Math.floor(random() * list.length)];

// Is this spot already spoken for by a landmark, a way underground or a lair?
function crowded(x, z) {
    if (landmarksNear(x, z, 24).length || dungeonsNear(x, z, 28).length) return true;
    for (const legend of LEGEND_LIST) {
        const lair = lairFor(legend.region);
        if (lair && Math.hypot(lair.x - x, lair.z - z) < 70) return true;
    }
    return false;
}

function kindFor(roll) {
    let sum = 0;
    for (const [kind, def] of Object.entries(POI_KINDS)) {
        sum += def.weight;
        if (roll < sum) return kind;
    }
    return 'haven';
}

const cache = new Map();
// The place in a cell of country, or null if the cell is empty. The same
// cell always gives the same answer.
export function poiForCell(cx, cz) {
    const key = cx + ':' + cz;
    if (cache.has(key)) return cache.get(key);
    const random = seededRandom(hash(cx, cz, 0x90e1));
    let poi = null;
    if (random() >= .14) {
        const roll = random(), nameRoll = random();
        for (let attempt = 0; attempt < 10 && !poi; attempt++) {
            const x = cx * POI_SPACING + 26 + random() * (POI_SPACING - 52);
            const z = cz * POI_SPACING + 26 + random() * (POI_SPACING - 52);
            if (isLake(x, z) || Math.hypot(x, z) < HOME_CLEAR || crowded(x, z)) continue;
            if (STARTER_POIS.some(starter => Math.hypot(starter.x - x, starter.z - z) < 60)) continue;
            // A waystone a short walk from the clearing's own would be no use.
            const rolled = kindFor(roll), region = regionAt(x, z);
            const kind = rolled === 'waystone' && Math.hypot(x, z) < WAYSTONE_MIN ? 'haven' : rolled;
            const name = kind === 'tower' ? `${TOWER_NAMES[Math.floor(nameRoll * TOWER_NAMES.length)]} Watchtower`
                : kind === 'waystone' ? `${STONE_NAMES[Math.floor(nameRoll * STONE_NAMES.length)]} Waystone`
                : kind === 'den' ? DENS[region].name : HAVENS[region].name;
            poi = Object.freeze({id: 'poi:' + key, kind, region, name, x, z,
                level: 1 + Math.min(8, Math.floor(Math.hypot(x, z) / 220))});
        }
    }
    cache.set(key, poi);
    return poi;
}

// The first layer only: starters and the 160 m grid.
export function gridPoisNear(x, z, radius = 200) {
    const result = STARTER_POIS.filter(poi => Math.hypot(poi.x - x, poi.z - z) <= radius);
    const range = Math.ceil(radius / POI_SPACING);
    const centerX = Math.floor(x / POI_SPACING), centerZ = Math.floor(z / POI_SPACING);
    for (let cx = centerX - range; cx <= centerX + range; cx++) {
        for (let cz = centerZ - range; cz <= centerZ + range; cz++) {
            const poi = poiForCell(cx, cz);
            if (poi && Math.hypot(poi.x - x, poi.z - z) <= radius) result.push(poi);
        }
    }
    return result;
}

const extras = new Map();
// The second layer's place in a cell, or null. Same cell, same answer.
export function extraForCell(cx, cz) {
    const key = cx + ':' + cz;
    if (extras.has(key)) return extras.get(key);
    const random = seededRandom(hash(cx, cz, 0x51ee));
    let poi = null;
    if (random() >= .25) {
        const roll = random(), nameRoll = random();
        for (let attempt = 0; attempt < 10 && !poi; attempt++) {
            const x = cx * EXTRA_SPACING + 30 + random() * (EXTRA_SPACING - 60);
            const z = cz * EXTRA_SPACING + 30 + random() * (EXTRA_SPACING - 60);
            if (isLake(x, z) || Math.hypot(x, z) < EXTRA_HOME_CLEAR || crowded(x, z) || gridPoisNear(x, z, 60).length) continue;
            let sum = 0, kind = 'cairn';
            for (const [name, def] of Object.entries(EXTRA_KINDS)) { sum += def.weight; if (roll < sum) { kind = name; break; } }
            const region = regionAt(x, z), base = {id: 'poi:x:' + key, kind, region, x, z, level: 1 + Math.min(8, Math.floor(Math.hypot(x, z) / 220))};
            if (kind === 'trader') {
                const keeper = KEEPERS[Math.floor(nameRoll * KEEPERS.length)];
                poi = Object.freeze({...base, keeper, name: `${keeper}'s trading camp`});
            } else if (kind === 'shrine') {
                const boon = Object.keys(SHRINES)[Math.floor(nameRoll * 3)];
                poi = Object.freeze({...base, boon, name: SHRINES[boon].name});
            } else poi = Object.freeze({...base, name: "Traveller's cairn"});
        }
    }
    extras.set(key, poi);
    return poi;
}

// Lakes sit on a lattice of their own; (m, n) names one. Most hold a wreck,
// on the bed near the middle where the water is deepest.
const LAKE_STEP = Math.PI / .005;
const wrecks = new Map();
export function wreckForLake(m, n) {
    if (!Number.isInteger(m) || !Number.isInteger(n) || (m + n) % 2 !== 0) return null; // No lake there.
    const key = m + ':' + n;
    if (wrecks.has(key)) return wrecks.get(key);
    const random = seededRandom(hash(m, n, 0x3ec4));
    let wreck = null;
    if (random() >= .15) {
        const angle = random() * Math.PI * 2, reach = 10 + random() * 35;
        const x = LAKE_STEP * (m + .5) + Math.sin(angle) * reach, z = LAKE_STEP * n + Math.cos(angle) * reach;
        const ship = SHIPS[Math.floor(random() * SHIPS.length)];
        wreck = Object.freeze({id: `poi:w:${key}`, kind: 'wreck', region: regionAt(x, z), name: `Wreck of the ${ship}`, x, z,
            level: 1 + Math.min(8, Math.floor(Math.hypot(x, z) / 220))});
    }
    wrecks.set(key, wreck);
    return wreck;
}

function wrecksNear(x, z, radius) {
    const result = [], range = Math.ceil((radius + 50) / LAKE_STEP);
    const centerM = Math.round(x / LAKE_STEP - .5), centerN = Math.round(z / LAKE_STEP);
    for (let m = centerM - range; m <= centerM + range; m++) {
        for (let n = centerN - range; n <= centerN + range; n++) {
            const wreck = wreckForLake(m, n);
            if (wreck && Math.hypot(wreck.x - x, wreck.z - z) <= radius) result.push(wreck);
        }
    }
    return result;
}

// Every place near a spot: both layers, and the wrecks.
export function poisNear(x, z, radius = 200) {
    const result = gridPoisNear(x, z, radius);
    const range = Math.ceil(radius / EXTRA_SPACING);
    const centerX = Math.floor(x / EXTRA_SPACING), centerZ = Math.floor(z / EXTRA_SPACING);
    for (let cx = centerX - range; cx <= centerX + range; cx++) {
        for (let cz = centerZ - range; cz <= centerZ + range; cz++) {
            const poi = extraForCell(cx, cz);
            if (poi && Math.hypot(poi.x - x, poi.z - z) <= radius) result.push(poi);
        }
    }
    result.push(...wrecksNear(x, z, radius));
    return result;
}

// Find a place again from its id, so a save only has to remember ids.
export function poiById(id) {
    const starter = STARTER_POIS.find(poi => poi.id === id);
    if (starter) return starter;
    const match = /^poi:(x:|w:)?(-?\d{1,6}):(-?\d{1,6})$/.exec(typeof id === 'string' ? id : '');
    if (!match) return null;
    const a = Number(match[2]), b = Number(match[3]);
    return match[1] === 'x:' ? extraForCell(a, b) : match[1] === 'w:' ? wreckForLake(a, b) : poiForCell(a, b);
}

// Everything a watchtower shows: landmarks, ways underground and other places.
export function surveyTargets(x, z, radius = SURVEY_RADIUS, siteRadius = SURVEY_SITE_RADIUS) {
    return [
        ...landmarksNear(x, z, Math.min(radius, siteRadius)).map(site => ({id: site.id, type: 'site', name: site.name, x: site.x, z: site.z})),
        ...dungeonsNear(x, z, radius).map(site => ({id: site.id, type: 'dungeon', name: site.name, x: site.x, z: site.z})),
        ...poisNear(x, z, radius).map(poi => ({id: poi.id, type: 'poi', name: poi.name, x: poi.x, z: poi.z}))
    ];
}

// Who comes out of a den. Further from home, the first of them is an elite.
export function denPack(poi) {
    const den = DENS[poi.region] || DENS.meadow;
    return Array.from({length: den.count}, (_, n) => ({kind: den.kind, elite: n === 0 && poi.level >= ELITE_LEVEL}));
}

export const denReady = (clearedDay, today) =>
    !Number.isFinite(clearedDay) || today - clearedDay >= DEN_REFILL_DAYS;

// How a den fight stands. Each defender is {health, present}: `present` is
// false once the world has let go of it, whether it died or was left behind.
export function denOutcome(defenders) {
    if (!defenders.length) return 'empty';
    if (defenders.some(one => one.present && one.health > 0)) return 'fighting';
    return defenders.every(one => one.health <= 0) ? 'cleared' : 'abandoned';
}

// A haven gives what it has once a day.
export const havenReady = (usedDay, today) => usedDay !== today;

// The other waystones you can step to from this one, nearest first.
export function travelChoices(attuned, from) {
    const out = [];
    for (const id of attuned) {
        const poi = poiById(id);
        if (!poi || poi.kind !== 'waystone' || poi.id === from?.id) continue;
        const dx = poi.x - (from?.x || 0), dz = poi.z - (from?.z || 0);
        out.push({...poi, distance: Math.hypot(dx, dz), bearing: Math.atan2(dx, dz)});
    }
    return out.sort((a, b) => a.distance - b.distance);
}

// --- Shrines, cairns, traders ----------------------------------------------
// Where a cairn's note sends you: a spot some way off, on dry ground.
const caches = new Map();
export function cacheFor(poi) {
    if (caches.has(poi.id)) return caches.get(poi.id);
    const random = seededRandom(hash(Math.round(poi.x), Math.round(poi.z), 0x7c41));
    let spot = null;
    for (let attempt = 0; attempt < 14 && !spot; attempt++) {
        const angle = random() * Math.PI * 2, distance = 140 + random() * 160;
        const x = poi.x + Math.sin(angle) * distance, z = poi.z + Math.cos(angle) * distance;
        if (isLake(x, z) || Math.hypot(x, z) < 90) continue;
        spot = Object.freeze({x, z, distance, bearing: angle});
    }
    caches.set(poi.id, spot);
    return spot;
}

const idSeed = id => { let seed = 0x811c9dc5; for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619); return seed | 0; };

// What a trader has today: three swaps and a piece of gear. The same trader
// on the same day always offers the same things.
export function tradeOffers(poi, day) {
    const random = seededRandom(idSeed(poi.id) ^ Math.imul(Math.max(1, Math.floor(day)), 0x27d4eb2d));
    const wants = WANTS[poi.region] || WANTS.meadow, sells = SELLS[poi.region] || SELLS.meadow;
    const start = Math.floor(random() * sells.length), offers = [];
    for (let n = 0; n < 3; n++) {
        const get = sells[(start + n) % sells.length], pool = wants.filter(item => item !== get);
        const give = pool[Math.floor(random() * pool.length)], lot = LOTS[get];
        offers.push({give: {[give]: Math.max(1, Math.ceil(WORTH[get] * lot * TRADE_MARGIN / WORTH[give]))}, get: {[get]: lot}, gear: false, stock: TRADE_STOCK});
    }
    // Gear is paid for in something worth carrying, not sixty berries.
    const dear = wants.filter(item => WORTH[item] >= 4), coin = dear[Math.floor(random() * dear.length)] || 'pelt';
    offers.push({give: {[coin]: Math.ceil(GEAR_PRICE * (1 + .2 * (poi.level - 1)) / WORTH[coin])}, get: null, gear: true, stock: 1});
    return offers;
}

export const canAfford = (inventory, offer) =>
    Object.entries(offer.give).every(([item, amount]) => (inventory[item] || 0) >= amount);
