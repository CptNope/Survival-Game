// Bow maths, kept free of the engine so the same numbers drive the game and
// its tests. Distances are metres, times seconds.
export const BOW = Object.freeze({
    drawTime: .8,     // Seconds to a full draw.
    minPower: .4,     // A snap shot still flies, weakly.
    speed: 46,        // Arrow speed at full draw.
    range: 46,        // How far a full-draw arrow travels.
    damage: 15,       // Before level, gear and perks.
    cooldown: .3,     // Between loosing one arrow and drawing the next.
    assist: .09       // Radians of aim help: a near miss is steered on.
});

// 0 at the first instant of the draw, 1 at full draw, easing out.
export function drawAmount(seconds) {
    const t = Math.max(0, Math.min(1, seconds / BOW.drawTime));
    return 1 - (1 - t) * (1 - t);
}

// Fraction of full damage, speed and range for a draw held this long.
export function drawPower(seconds) {
    return BOW.minPower + (1 - BOW.minPower) * drawAmount(seconds);
}

// Damage for one arrow. `level` is the player's level, `gearPower` the
// weapon power from gear, `bonus` the summed fractional bonuses (perks, boons).
export function arrowDamage(power, level = 1, gearPower = 0, bonus = 0) {
    return (BOW.damage + (level - 1) * 2.5 + gearPower * .8) * power * (1 + bonus);
}

// Where along the segment a->b it first enters a sphere: 0..1, or null.
export function segmentHit(a, b, centre, radius) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const fx = a.x - centre.x, fy = a.y - centre.y, fz = a.z - centre.z;
    const c = fx * fx + fy * fy + fz * fz - radius * radius;
    if (c <= 0) return 0; // Already inside.
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    if (lengthSquared === 0) return null;
    const half = fx * dx + fy * dy + fz * dz;
    const discriminant = half * half - lengthSquared * c;
    if (discriminant < 0) return null;
    const t = (-half - Math.sqrt(discriminant)) / lengthSquared;
    return t >= 0 && t <= 1 ? t : null;
}

// A unit vector from yaw (about Y, 0 = +Z) and pitch (positive looks down),
// matching the player camera's rotation.
export function aimVector(yaw, pitch) {
    const flat = Math.cos(pitch);
    return {x: Math.sin(yaw) * flat, y: -Math.sin(pitch), z: Math.cos(yaw) * flat};
}

// Steer `direction` onto the candidate nearest the line of fire, if one lies
// within `assist` radians and `reach` metres. Candidates are {x, y, z}.
// Returns the (possibly unchanged) unit direction.
export function assistAim(origin, direction, candidates, reach, assist = BOW.assist) {
    let best = null, bestAngle = assist;
    for (const target of candidates) {
        const tx = target.x - origin.x, ty = target.y - origin.y, tz = target.z - origin.z;
        const distance = Math.hypot(tx, ty, tz);
        if (distance < .5 || distance > reach) continue;
        const cosine = (tx * direction.x + ty * direction.y + tz * direction.z) / distance;
        const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
        if (angle < bestAngle) { bestAngle = angle; best = {x: tx / distance, y: ty / distance, z: tz / distance}; }
    }
    return best || direction;
}
