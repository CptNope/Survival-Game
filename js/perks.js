// Perks: one point per level after the first, spent on a choice of three.
// Pure data and maths; the PerkSystem component applies them.
export const PERKS = Object.freeze({
    brawler: {name: 'Brawler', text: '+12% damage with tools and spears', stat: 'melee', per: .12, max: 3},
    marksman: {name: 'Marksman', text: '+15% damage with the bow', stat: 'ranged', per: .15, max: 3},
    tough: {name: 'Tough', text: '+20 maximum health', stat: 'health', per: 20, max: 3},
    fleet: {name: 'Fleet', text: '+6% movement speed', stat: 'speed', per: .06, max: 3},
    hardy: {name: 'Hardy', text: 'Hunger and thirst build 15% slower', stat: 'appetite', per: .15, max: 3},
    insulated: {name: 'Insulated', text: 'The cold builds 20% slower', stat: 'insulation', per: .2, max: 2},
    forager: {name: 'Forager', text: '20% chance of an extra item when gathering', stat: 'forage', per: .2, max: 3},
    fletcher: {name: 'Fletcher', text: '25% of loosed arrows are not used up', stat: 'recover', per: .25, max: 2},
    acrobat: {name: 'Acrobat', text: 'Dodge is ready 20% sooner', stat: 'dodge', per: .2, max: 2},
    medic: {name: 'Field medic', text: 'Remedies heal 25% more', stat: 'healing', per: .25, max: 2},
    lucky: {name: 'Treasure hunter', text: 'Dropped gear rolls better', stat: 'luck', per: .1, max: 2}
});
export const PERK_IDS = Object.freeze(Object.keys(PERKS));
export const OFFER_SIZE = 3;

// Points earned by reaching `level`.
export const pointsFor = level => Math.max(0, Math.floor(level) - 1);

export const ranksSpent = ranks => PERK_IDS.reduce((sum, id) => sum + (ranks[id] || 0), 0);

// The total of one stat across every rank owned.
export function perkValue(ranks, stat) {
    let total = 0;
    for (const id of PERK_IDS) if (PERKS[id].stat === stat) total += (ranks[id] || 0) * PERKS[id].per;
    return total;
}

function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The three perks on offer for the next point. The same ranks always give the
// same offer, so reopening the panel (or reloading) cannot reroll it.
export function perkOffer(ranks, salt = 0) {
    const open = PERK_IDS.filter(id => (ranks[id] || 0) < PERKS[id].max);
    const random = mulberry(Math.imul(ranksSpent(ranks) + 1, 2654435761) ^ Math.imul(salt + 7, 40503));
    for (let i = open.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [open[i], open[j]] = [open[j], open[i]];
    }
    return open.slice(0, OFFER_SIZE);
}

// Clean a saved record: known perks only, whole ranks within their limits.
export function sanitizeRanks(saved) {
    const ranks = {};
    for (const id of PERK_IDS) {
        const rank = Math.floor(Number(saved?.[id]));
        if (rank > 0) ranks[id] = Math.min(PERKS[id].max, rank);
    }
    return ranks;
}
