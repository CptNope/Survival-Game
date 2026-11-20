// The year. Four seasons of three days each, worked out from the day count
// alone: nothing new is saved, and an expedition begun before there were
// seasons simply finds itself somewhere in the calendar. Pure maths, no
// engine, so the weather, the garden, the terrain and the tests all agree.
import { REGIONS } from './regions.js';

export const SEASON_DAYS = 3;
export const SEASON_IDS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
export const YEAR_DAYS = SEASON_DAYS * SEASON_IDS.length;
// The land takes a new season's colours over its first morning, dawn to noon,
// so the change is seen in daylight and follows the news of it.
export const TURN_DAYS = .25;
export const LOOK_STEPS = 6;

// chill:  cold a second added in the open, day and night
// night:  how hard the ordinary night chill bites
// thirst: how fast thirst builds by day
// crops:  how fast garden beds grow
// wild:   how fast gathered plants grow back
// forage: extra from each bush, herb, mushroom and garden bed
// game:   extra meat from each hunted animal
// skies:  of every seven spells of weather, how many are clear and how many
//         are clear or rain; the rest are storms
export const SEASONS = Object.freeze({
    spring: {id: 'spring', name: 'Spring', note: 'Rain, quick crops, and wild plants that grow back in half the time',
        chill: 0, night: 1, thirst: 1, crops: 1.5, wild: 2, forage: 0, game: 0, skies: [3, 6]},
    summer: {id: 'summer', name: 'Summer', note: 'Clear skies and mild nights · thirst comes quicker by day',
        chill: 0, night: .7, thirst: 1.2, crops: 1, wild: 1, forage: 0, game: 0, skies: [5, 6]},
    autumn: {id: 'autumn', name: 'Autumn', note: 'The leaves turn · bushes, herbs, mushrooms and garden beds give one more',
        chill: 0, night: 1, thirst: 1, crops: 1, wild: 1, forage: 1, game: 0, skies: [3, 5]},
    winter: {id: 'winter', name: 'Winter', note: 'Snow, and cold even at noon · wild plants will not grow back until spring',
        chill: .25, night: 1, thirst: 1, crops: .25, wild: 0, forage: 0, game: 1, skies: [4, 6]}
});

// Plants that wait for the season. Trees, rock and ore keep their own time.
export const WILD_PLANTS = Object.freeze(['fiber', 'herb', 'berry', 'mushroom', 'cactus']);

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
// Exact at both ends, so a finished turn is the new season to the last bit.
const mix3 = (a, b, t) => t <= 0 ? [...a] : t >= 1 ? [...b] : [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clock = moment => Number.isFinite(moment) ? Math.max(1, moment) : 1;

// Where a day falls in the year. Day 1 is the first day of spring.
export function seasonAt(day = 1) {
    const whole = Math.floor(clock(day)) - 1;
    const index = Math.floor(whole / SEASON_DAYS) % SEASON_IDS.length;
    const id = SEASON_IDS[index], next = SEASON_IDS[(index + 1) % SEASON_IDS.length];
    return {id, index, def: SEASONS[id], next, day: whole % SEASON_DAYS + 1,
        daysLeft: SEASON_DAYS - whole % SEASON_DAYS, year: Math.floor(whole / YEAR_DAYS) + 1};
}

// The moment the season holding `moment` gives way to the next.
export function seasonEnd(moment) {
    return 1 + (Math.floor((clock(moment) - 1) / SEASON_DAYS) + 1) * SEASON_DAYS;
}

// "Autumn, day 2 of 3 · Winter in 2 days", for the map and the menu.
export function calendarLine(day) {
    const at = seasonAt(day), next = SEASONS[at.next].name;
    return `${at.def.name}, day ${at.day} of ${SEASON_DAYS} · `
        + (at.daysLeft === 1 ? `${next} comes tomorrow` : `${next} in ${at.daysLeft} days`);
}

// What dawn has to say about the calendar, if anything: a new season on its
// first morning, and a day's warning before the next.
export function dawnMessage(day) {
    const at = seasonAt(day);
    if (at.day === 1) return `${at.def.name} has come · ${at.def.note}`;
    if (at.daysLeft !== 1) return null;
    return at.next === 'winter' ? 'Winter comes tomorrow · gather food and herbs while they still grow'
        : `${SEASONS[at.next].name} comes tomorrow`;
}

// Growing done between two moments, in days, at each season's pace. `pace`
// is 'crops' for garden beds and 'wild' for gathered plants.
export function grownDays(from, to, pace = 'crops') {
    from = clock(from); to = clock(to);
    if (!(to > from)) return 0;
    const year = SEASON_IDS.reduce((sum, id) => sum + SEASONS[id][pace] * SEASON_DAYS, 0);
    const years = Math.floor((to - from) / YEAR_DAYS);
    let total = years * year, at = from + years * YEAR_DAYS;
    while (at < to) {
        const end = Math.min(to, seasonEnd(at));
        total += (end - at) * seasonAt(at).def[pace];
        at = end;
    }
    return total;
}

// The moment `needed` days of growing will have been done, counting from `from`.
export function readyAt(from, needed, pace = 'crops') {
    from = clock(from);
    if (!(needed > 0)) return from;
    const year = SEASON_IDS.reduce((sum, id) => sum + SEASONS[id][pace] * SEASON_DAYS, 0);
    if (!(year > 0)) return Infinity;
    // Stop one year short so the last, partial year is walked season by season.
    const years = Math.max(0, Math.ceil(needed / year) - 1);
    let left = needed - years * year, at = from + years * YEAR_DAYS;
    for (let i = 0; i <= SEASON_IDS.length * 2; i++) {
        const end = seasonEnd(at), rate = seasonAt(at).def[pace];
        if (rate > 0 && left <= (end - at) * rate + 1e-9) return at + left / rate;
        left -= (end - at) * rate;
        at = end;
    }
    return at;
}

// Has a gathered node grown back? `since` is the day it was gathered.
export function regrown(type, since, today, wait) {
    return (WILD_PLANTS.includes(type) ? grownDays(since, today, 'wild') : today - since) >= wait - 1e-9;
}

// Rain falls as snow all winter, except deep in the desert, and all year in
// Frostfell. `strength` is how far into the region you are (0..1).
export function precipitation(weather, season, region = 'meadow', strength = 1) {
    if (weather !== 'rain' && weather !== 'storm') return 'clear';
    const deep = strength >= .5;
    const snow = region === 'tundra' && deep ? true : season === 'winter' && !(region === 'desert' && deep);
    return snow ? (weather === 'storm' ? 'blizzard' : 'snow') : weather;
}
export const SKY_LABELS = Object.freeze({clear: 'Clear skies', rain: 'Rain', storm: 'Storm', snow: 'Snow', blizzard: 'Blizzard'});

// Cold a second the season adds to anyone out in the open. The desert barely
// feels winter.
export function seasonChill(season, region = 'meadow', strength = 1) {
    const chill = SEASONS[season]?.chill || 0;
    return region === 'desert' ? chill * (1 - .75 * Math.max(0, Math.min(1, strength))) : chill;
}

// --- How it looks ----------------------------------------------------------
// Only the Greenwood and Mirefen change their ground: Frostfell is always
// white and Sunscar always sand. Summer is the land as it was drawn before.
const GROUND = {
    spring: {meadow: [[.28, .47, .21], [.43, .58, .26]], marsh: [[.20, .30, .19], [.31, .38, .21]]},
    summer: {meadow: REGIONS.meadow.ground, marsh: REGIONS.marsh.ground},
    autumn: {meadow: [[.37, .38, .20], [.52, .47, .24]], marsh: [[.26, .25, .16], [.36, .32, .18]]},
    winter: {meadow: [[.78, .83, .87], [.93, .95, .97]], marsh: [[.45, .51, .48], [.60, .65, .62]]}
};
const GRASS = {
    spring: {meadow: [[.27, .47, .19], [.36, .55, .21], [.47, .58, .25], [.24, .40, .19]],
        marsh: [[.20, .35, .17], [.28, .40, .17], [.34, .41, .19], [.16, .28, .16]]},
    summer: {meadow: REGIONS.meadow.grass, marsh: REGIONS.marsh.grass},
    autumn: {meadow: [[.47, .41, .18], [.58, .47, .20], [.62, .52, .24], [.40, .33, .17]],
        marsh: [[.30, .29, .15], [.38, .33, .16], [.42, .36, .18], [.24, .24, .14]]},
    winter: {meadow: [[.70, .76, .78], [.82, .86, .88], [.60, .66, .64], [.90, .93, .95]],
        marsh: [[.46, .52, .48], [.56, .61, .57], [.40, .46, .42], [.64, .69, .66]]}
};
const SNOW = [.90, .93, .96], RIMED = [.66, .68, .70], BLOSSOM = [.86, .66, .70];
const TURNED = [[.80, .45, .13], [.72, .25, .12], [.84, .64, .18], [.62, .36, .14]];

// The colour of one clump of leaves or tier of needles in a season. `base`
// is the colour it was built with; `index` is which clump or tier it is.
export function foliageColor(kind, index, base, season) {
    if (kind === 'oak') {
        if (season === 'spring') return index % 4 === 1 ? BLOSSOM : mix3(base, [.44, .62, .26], .6);
        if (season === 'autumn') return TURNED[index % TURNED.length];
        if (season === 'winter') return index % 3 === 0 ? RIMED : SNOW;
    } else if (kind === 'bogtree') {
        if (season === 'spring') return mix3(base, [.26, .40, .20], .5);
        if (season === 'autumn') return index % 2 ? [.40, .34, .16] : [.33, .31, .15];
        if (season === 'winter') return index % 2 ? [.56, .62, .59] : mix3(base, [.56, .62, .59], .45);
    } else if (kind === 'pine') {
        // Evergreen, but the boughs carry snow like their Frostfell cousins.
        if (season === 'winter') return index % 2 || index === 4 ? SNOW : mix3(base, [.20, .34, .32], .6);
    }
    return base;
}

// Which two seasons the land is between, and how far. The change comes in
// LOOK_STEPS steps over a season's first morning, then the look holds. An
// expedition's very first morning is plain spring: no winter came before it.
export function seasonBlend(now) {
    const at = seasonAt(now), into = (clock(now) - 1) % SEASON_DAYS;
    const before = SEASON_IDS[(at.index + SEASON_IDS.length - 1) % SEASON_IDS.length];
    const settled = into >= TURN_DAYS || clock(now) < 1 + TURN_DAYS;
    const step = settled ? LOOK_STEPS : Math.round(smooth(into / TURN_DAYS) * LOOK_STEPS);
    return {from: before, to: at.id, t: step / LOOK_STEPS,
        key: step === LOOK_STEPS ? at.id : step ? `${before}>${at.id}:${step}` : before};
}

// Everything the terrain needs to colour itself at a moment in time.
export function seasonLook(now) {
    const blend = seasonBlend(now), {from, to, t} = blend, look = {...blend, ground: {}, grass: {}};
    for (const region of ['meadow', 'marsh']) {
        look.ground[region] = GROUND[from][region].map((colour, i) => mix3(colour, GROUND[to][region][i], t));
        look.grass[region] = GRASS[from][region].map((colour, i) => mix3(colour, GRASS[to][region][i], t));
    }
    // How much snow lies: on the high ground as well as the low.
    look.snow = mix(from === 'winter' ? 1 : 0, to === 'winter' ? 1 : 0, t);
    look.foliage = (kind, index, base) => t >= 1 ? foliageColor(kind, index, base, to)
        : mix3(foliageColor(kind, index, base, from), foliageColor(kind, index, base, to), t);
    return look;
}
