// The dog: numbers and decisions, free of the engine so they can be tested.
export const DOG = Object.freeze({
    health: 70, damage: 9, cooldown: 1.1, reach: 2.1,
    speed: 6.4,       // A little faster than the player walks, so it keeps up.
    heel: 3.2,        // How far behind it likes to trot.
    guard: 15,        // It defends you from anything within this of you.
    leash: 36,        // Further than this and it appears at your side.
    revive: 45,       // Seconds down before it gets back up.
    regen: 1.5,       // Health a second once the fighting has stopped.
    calm: 6,          // Seconds without a fight before it starts to mend.
    risk: .5, share: .35  // How often a bitten creature bites back, and how hard.
});
export const STRAY = Object.freeze({appear: 12, sit: 9, reach: 3.2, forget: 80});

// Is this creature after the player? The dog defends; it does not start fights.
export function isThreat(creature, def) {
    if (!(creature.health > 0)) return false;
    if (creature.kind === 'wolf') return Boolean(creature.alerted) || creature.fleeTimer > 0;
    if (!def?.brain) return false;
    return (creature.state && creature.state !== 'roam') || creature.fleeTimer > 0;
}

// The threat to go for: the nearest to the dog among those close to the player.
// `threats` are {x, z, ...}; returns one of them or null.
export function chooseTarget(dog, player, threats) {
    let best = null, nearest = Infinity;
    for (const threat of threats) {
        if (Math.hypot(threat.x - player.x, threat.z - player.z) > DOG.guard) continue;
        const distance = Math.hypot(threat.x - dog.x, threat.z - dog.z);
        if (distance < nearest) { nearest = distance; best = threat; }
    }
    return best;
}

// Where the dog wants to be when nothing is wrong: behind and to one side.
export function heelPoint(player, yaw) {
    const back = yaw + Math.PI - .5;
    return {x: player.x + Math.sin(back) * DOG.heel, z: player.z + Math.cos(back) * DOG.heel};
}

// One step from `from` toward `to`, no further than `reach` short of it.
// Returns {x, z, moved, heading}.
export function stepToward(from, to, distance, stopShort = 0) {
    const dx = to.x - from.x, dz = to.z - from.z, gap = Math.hypot(dx, dz);
    const travel = Math.max(0, Math.min(distance, gap - stopShort));
    if (gap < 1e-6 || travel <= 0) return {x: from.x, z: from.z, moved: 0, heading: gap < 1e-6 ? null : Math.atan2(dx, dz)};
    return {x: from.x + dx / gap * travel, z: from.z + dz / gap * travel, moved: travel, heading: Math.atan2(dx, dz)};
}

// Clean a saved companion record.
export function sanitizeCompanion(saved) {
    if (!saved || saved.tamed !== true) return {tamed: false, health: DOG.health, mode: 'follow'};
    const health = Number.isFinite(saved.health) ? Math.max(1, Math.min(DOG.health, saved.health)) : DOG.health;
    return {tamed: true, health, mode: saved.mode === 'stay' ? 'stay' : 'follow'};
}
