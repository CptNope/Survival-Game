// Bounties: jobs posted on the notice boards at traders and watchtowers.
// Hunt something, fetch something, or clear a den, then come back to the
// board for a piece of gear. Pure rules: the same board on the same day
// always posts the same job.
import { WANTS, WORTH, gridPoisNear } from './pois.js';
import { CREATURES } from './creatures.js';
import { ITEMS, itemAmount } from './resources.js';
import { seededRandom } from './models/wilderness.js';

export const BOARD_KINDS = Object.freeze(['trader', 'tower']);
export const BOARD_DAYS = 3;      // A board posts something new every three days.
export const MAX_BOUNTIES = 3;    // Jobs you can have in hand at once.
export const DEN_REACH = 450;     // How far from a board a den job may send you.
export const BOUNTY_KINDS = Object.freeze(['hunt', 'fetch', 'clear']);

// What each region pays to be rid of.
export const QUARRY = Object.freeze({meadow: ['wolf', 'boar'], tundra: ['icewolf'], desert: ['scorpion'], marsh: ['toad']});
const PLURALS = {wolf: 'wolves', icewolf: 'ice wolves'};
export const quarryName = (kind, count = 2) => {
    const label = (CREATURES[kind]?.label || kind).toLowerCase();
    return count === 1 ? label : PLURALS[kind] || label + 's';
};

const whole = day => Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
// Which posting a day falls in, and the day the next one goes up.
export const boardPeriod = day => Math.floor((whole(day) - 1) / BOARD_DAYS);
export const nextPosting = day => (boardPeriod(day) + 1) * BOARD_DAYS + 1;

const seedOf = text => { let seed = 0x811c9dc5; for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619); return seed | 0; };

// The job a board has up. `denOpen(den)` says whether a den is lived in: a
// den job is only posted for one that is, and a hunt is posted otherwise.
// Watchtowers have nobody to hand goods to, so they never ask for a delivery.
export function bountyFor(poi, day, {denOpen = () => true} = {}) {
    if (!poi || !BOARD_KINDS.includes(poi.kind)) return null;
    const period = boardPeriod(day), level = Math.max(1, poi.level || 1);
    const random = seededRandom(seedOf(poi.id) ^ Math.imul(period + 1, 0x27d4eb2d));
    const roll = random(), pick = random(), base = {board: poi.id, period, level};
    const hunt = () => {
        const kinds = QUARRY[poi.region] || QUARRY.meadow;
        return {...base, kind: 'hunt', target: kinds[Math.floor(pick * kinds.length)], need: 3 + Math.min(3, level - 1)};
    };
    if (roll < .4) return hunt();
    if (roll < .7 && poi.kind === 'trader') {
        const goods = (WANTS[poi.region] || WANTS.meadow).filter(item => WORTH[item] >= 1.5);
        const target = goods[Math.floor(pick * goods.length)];
        return {...base, kind: 'fetch', target, need: Math.max(2, Math.ceil(16 * (1 + .25 * (level - 1)) / WORTH[target]))};
    }
    const den = gridPoisNear(poi.x, poi.z, DEN_REACH).filter(place => place.kind === 'den' && denOpen(place))
        .sort((a, b) => Math.hypot(a.x - poi.x, a.z - poi.z) - Math.hypot(b.x - poi.x, b.z - poi.z))[0];
    return den ? {...base, kind: 'clear', target: den.id, need: 1} : hunt();
}

// "Wanted: 4 scorpions". `place` is the den, for a den job.
export function bountyTitle(job, place = null) {
    if (job.kind === 'hunt') return `Wanted: ${job.need} ${quarryName(job.target, job.need)}`;
    if (job.kind === 'fetch') return `Wanted: ${itemAmount(job.target, job.need)}`;
    return `Wanted: ${place?.name || 'a den'} cleared out`;
}

// What the board pays: a piece of gear a level above the country it is in,
// rolled with better luck than a den's, and experience.
export const bountyReward = job => ({xp: 30 + 15 * job.level, gearLevel: job.level + 1, luck: .5});

// Is a saved job one this game could have posted? Guards restored saves.
export function validJob(job) {
    if (!job || !BOUNTY_KINDS.includes(job.kind) || typeof job.board !== 'string') return false;
    const int = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
    if (!int(job.need, 1, 60) || !int(job.level, 1, 99) || !int(job.period, 0, 1e6)) return false;
    if (job.kind === 'hunt') return Boolean(CREATURES[job.target]);
    if (job.kind === 'fetch') return Object.hasOwn(ITEMS, job.target);
    return typeof job.target === 'string';
}
