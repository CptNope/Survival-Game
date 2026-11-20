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

export function poisNear(x, z, radius = 200) {
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

// Find a place again from its id, so a save only has to remember ids.
export function poiById(id) {
    const starter = STARTER_POIS.find(poi => poi.id === id);
    if (starter) return starter;
    const match = /^poi:(-?\d{1,6}):(-?\d{1,6})$/.exec(typeof id === 'string' ? id : '');
    return match ? poiForCell(Number(match[1]), Number(match[2])) : null;
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
