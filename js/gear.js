// Gear: found equipment with randomly rolled stat bonuses. An item's rarity is
// not rolled directly. It is *graded* from the bonuses the item ended up with,
// so a Legendary is always measurably stronger than a Rare of the same level.
// Everything here is pure data and arithmetic: no engine, no DOM, seedable.

export const RARITIES = Object.freeze([
    {id: 'common', name: 'Common', color: '#b9c2b3', score: 0},
    {id: 'uncommon', name: 'Uncommon', color: '#74d06a', score: 1.5},
    {id: 'rare', name: 'Rare', color: '#5fa8ff', score: 2.6},
    {id: 'epic', name: 'Epic', color: '#bb82ff', score: 3.8},
    {id: 'legendary', name: 'Legendary', color: '#ffb23e', score: 5}
]);
export const rarityIndex = id => Math.max(0, RARITIES.findIndex(rarity => rarity.id === id));

export const SLOTS = Object.freeze({weapon: 'Weapon', armor: 'Armor', boots: 'Boots', charm: 'Charm'});

// `unit` is how much of a stat one grading point buys at item level 1.
// `growth` is how much that grows per item level; `cap` limits the total
// from all equipped gear so percentages can never run away.
export const STATS = Object.freeze({
    power: {label: 'Damage', unit: 4, growth: .3, suffix: '', cap: 999},
    crit: {label: 'Critical chance', unit: 4, growth: .04, suffix: '%', cap: 60},
    haste: {label: 'Swing speed', unit: 5, growth: .04, suffix: '%', cap: 50},
    leech: {label: 'Health per hit', unit: 1.5, growth: .15, suffix: '', cap: 40},
    vitality: {label: 'Max health', unit: 12, growth: .22, suffix: '', cap: 999},
    armor: {label: 'Damage reduction', unit: 4, growth: .04, suffix: '%', cap: 60},
    warmth: {label: 'Cold resistance', unit: 10, growth: .03, suffix: '%', cap: 80},
    endurance: {label: 'Slower hunger and thirst', unit: 8, growth: .03, suffix: '%', cap: 70},
    swiftness: {label: 'Move speed', unit: 4, growth: .03, suffix: '%', cap: 40},
    fortune: {label: 'Bonus experience', unit: 6, growth: .04, suffix: '%', cap: 100}
});

// The first stat of each pool is the slot's signature and is always present.
const POOLS = {
    weapon: ['power', 'crit', 'haste', 'leech', 'fortune'],
    armor: ['vitality', 'armor', 'warmth', 'endurance', 'leech'],
    boots: ['swiftness', 'endurance', 'armor', 'warmth', 'vitality'],
    charm: ['fortune', 'crit', 'vitality', 'power', 'warmth', 'swiftness', 'haste', 'endurance']
};
const BASES = {
    weapon: ['Hatchet', 'Cleaver', 'Pike', 'Maul', 'Hunting Blade', 'War Pick'],
    armor: ['Hide Vest', 'Padded Coat', 'Ringmail', 'Bone Harness', 'Warden Plate'],
    boots: ['Trail Boots', 'Fur Wraps', 'Striders', 'Greaves'],
    charm: ['Talisman', 'Carved Idol', 'Signet', 'Rune Stone', 'Fang Necklace']
};
const PREFIX = {
    power: 'Savage', crit: 'Keen', haste: 'Quick', leech: 'Thirsting', vitality: 'Stalwart',
    armor: 'Ironbound', warmth: 'Ember-lined', endurance: 'Tireless', swiftness: 'Fleet', fortune: 'Lucky'
};
const SUFFIX = {
    power: 'of the Bear', crit: 'of the Hawk', haste: 'of the Gale', leech: 'of the Leech', vitality: 'of the Oak',
    armor: 'of the Mountain', warmth: 'of the Hearth', endurance: 'of the Long Road', swiftness: 'of the Hare',
    fortune: 'of the Seeker'
};

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
// What one grading point of `stat` is worth at `level`.
export const statUnit = (stat, level = 1) => STATS[stat].unit * (1 + (Math.max(1, level) - 1) * STATS[stat].growth);
const roundStat = (stat, value) => STATS[stat].unit < 2 ? Math.round(value * 2) / 2 : Math.round(value);

// Grading score: how many "points" of bonuses the item carries for its level.
export function gearScore(item) {
    let score = 0;
    for (const [stat, value] of Object.entries(item?.stats || {})) {
        if (STATS[stat] && value > 0) score += value / statUnit(stat, item.level);
    }
    return score;
}

export function gradeForScore(score) {
    let grade = RARITIES[0];
    for (const rarity of RARITIES) if (score >= rarity.score) grade = rarity;
    return grade.id;
}

function nameFor(slot, stats, rarity, random) {
    const ranked = Object.keys(stats).sort((a, b) => stats[b] / STATS[b].unit - stats[a] / STATS[a].unit);
    const base = pick(BASES[slot], random);
    const grade = rarityIndex(rarity);
    const prefix = grade >= 1 ? PREFIX[ranked[0]] + ' ' : '';
    const suffix = grade >= 2 && ranked[1] ? ' ' + SUFFIX[ranked[1]] : '';
    return prefix + base + suffix;
}

let serial = 0;

// Roll one item. `luck` (0..1+) skews towards more and stronger bonuses;
// `minRarity` guarantees a floor for boss chests. `random` is any () => [0,1).
export function rollGear(random, {level = 1, luck = 0, slot = null, minRarity = 'common'} = {}) {
    level = clamp(Math.floor(level) || 1, 1, 60);
    slot = SLOTS[slot] ? slot : pick(Object.keys(SLOTS), random);
    const pool = POOLS[slot];
    const floor = RARITIES[rarityIndex(minRarity)].score;
    let stats = {};
    for (let attempt = 0; attempt < 6; attempt++) {
        // Quality drives both how many bonuses appear and how big they roll.
        const quality = Math.pow(random(), 1 / (1 + Math.max(0, luck) + attempt * .6));
        const count = 1 + (quality > .5) + (quality > .8) + (quality > .95);
        const chosen = [slot === 'charm' ? pick(pool, random) : pool[0]];
        while (chosen.length < Math.min(count, pool.length)) {
            const stat = pick(pool, random);
            if (!chosen.includes(stat)) chosen.push(stat);
        }
        stats = {};
        for (const stat of chosen) {
            const points = (.5 + random() * .7) * (.75 + quality * .6);
            stats[stat] = Math.max(roundStat(stat, statUnit(stat, level) * .34), roundStat(stat, statUnit(stat, level) * points));
        }
        if (gearScore({stats, level}) >= floor) break;
    }
    // Boss loot that still fell short is strengthened until it makes the grade.
    // Rounding can undo a single boost, so repeat until the score is there.
    let score = gearScore({stats, level});
    for (let guard = 0; score < floor && guard < 40; guard++) {
        const boost = Math.max(1.04, floor / score * 1.02);
        for (const stat of Object.keys(stats)) {
            const step = STATS[stat].unit < 2 ? .5 : 1;
            stats[stat] = Math.max(stats[stat] + step, roundStat(stat, stats[stat] * boost));
        }
        score = gearScore({stats, level});
    }
    const rarity = gradeForScore(score);
    return {
        id: 'g' + Date.now().toString(36) + (serial++).toString(36) + Math.floor(random() * 1e6).toString(36),
        slot, level, rarity, stats, name: nameFor(slot, stats, rarity, random)
    };
}

// Combined bonuses of everything equipped, with caps applied.
export function totalStats(equipped) {
    const total = Object.fromEntries(Object.keys(STATS).map(stat => [stat, 0]));
    for (const item of Object.values(equipped || {})) {
        if (!item) continue;
        for (const [stat, value] of Object.entries(item.stats || {})) {
            if (STATS[stat]) total[stat] += value;
        }
    }
    for (const stat of Object.keys(total)) total[stat] = Math.min(STATS[stat].cap, total[stat]);
    return total;
}

export function describeStat(stat, value) {
    const info = STATS[stat];
    const amount = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return `+${amount}${info.suffix} ${info.label}`;
}

// What breaking an item down returns.
export function salvageValue(item) {
    const grade = rarityIndex(item.rarity);
    return {xp: Math.round((6 + item.level * 3) * (1 + grade * .8)), iron: grade >= 2 ? grade - 1 : 0};
}

// Rebuild an item from untrusted save data. Rarity is always re-graded from
// the stats, so an edited save cannot claim a grade its bonuses do not earn.
export function sanitizeGear(raw) {
    if (!raw || typeof raw !== 'object' || !SLOTS[raw.slot]) return null;
    const level = clamp(Math.floor(Number(raw.level)) || 1, 1, 60);
    const stats = {};
    for (const [stat, value] of Object.entries(raw.stats && typeof raw.stats === 'object' ? raw.stats : {})) {
        if (!STATS[stat] || !Number.isFinite(value) || value <= 0 || Object.keys(stats).length >= 4) continue;
        stats[stat] = Math.min(roundStat(stat, value), roundStat(stat, statUnit(stat, level) * 3));
    }
    if (!Object.keys(stats).length) return null;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : SLOTS[raw.slot];
    const id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : 'g' + (serial++).toString(36) + 'r';
    return {id, slot: raw.slot, level, stats, name, rarity: gradeForScore(gearScore({stats, level}))};
}
