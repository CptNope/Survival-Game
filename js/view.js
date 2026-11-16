// Camera views: where the camera sits in each mode and what the player is
// aiming at when there is no reticle to aim with. Pure maths, no engine.
export const VIEW_MODES = Object.freeze(['first', 'third', 'overhead']);
export const VIEW_LABELS = Object.freeze({first: 'First-person view', third: 'Third-person view', overhead: 'Overhead view'});
export const ZOOM = Object.freeze({third: {min: 3, max: 9, start: 5.5}, overhead: {min: 11, max: 32, start: 19}});

export const isView = mode => VIEW_MODES.includes(mode);
export const nextView = mode => VIEW_MODES[(VIEW_MODES.indexOf(mode) + 1) % VIEW_MODES.length] || 'first';
export const clampZoom = (mode, value) => ZOOM[mode] ? Math.max(ZOOM[mode].min, Math.min(ZOOM[mode].max, value)) : value;

// Where the camera wants to be, and what it looks at. `eye` is the player's
// head; yaw 0 faces +z and positive pitch looks down, as in the engine.
export function cameraRig(mode, eye, yaw, pitch, distance) {
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    if (mode === 'overhead') {
        // High and a little behind, so "up" on screen is the way the player faces.
        const back = distance * .45;
        return {
            position: {x: eye.x - sin * back, y: eye.y + distance, z: eye.z - cos * back},
            target: {x: eye.x + sin * 1.5, y: eye.y - 1.2, z: eye.z + cos * 1.5}
        };
    }
    // Third person: over the right shoulder, swinging up and down with the look pitch.
    const tilt = Math.max(-.5, Math.min(1.15, pitch));
    const forward = {x: sin * Math.cos(tilt), y: -Math.sin(tilt), z: cos * Math.cos(tilt)};
    const target = {x: eye.x + cos * .55, y: eye.y + .2, z: eye.z - sin * .55};
    return {
        position: {x: target.x - forward.x * distance, y: target.y - forward.y * distance + .3, z: target.z - forward.z * distance},
        target: {x: target.x + forward.x * 3, y: target.y + forward.y * 3, z: target.z + forward.z * 3}
    };
}

// Pull the camera in towards the player until nothing solid is in the way.
// `clear(x, y, z)` says whether a point is open air.
export function clampRig(rig, anchor, clear, steps = 12) {
    let best = .12;
    for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const x = anchor.x + (rig.position.x - anchor.x) * t, y = anchor.y + (rig.position.y - anchor.y) * t,
            z = anchor.z + (rig.position.z - anchor.z) * t;
        if (!clear(x, y, z)) break;
        best = t;
    }
    return {
        x: anchor.x + (rig.position.x - anchor.x) * best, y: anchor.y + (rig.position.y - anchor.y) * best,
        z: anchor.z + (rig.position.z - anchor.z) * best, fraction: best
    };
}

// With no reticle, the target is whatever stands closest in front of the
// player. Candidates are {x, z, bias?}; a positive bias makes one preferred.
export function coneTarget(origin, yaw, candidates, reach, halfAngle = 1.05) {
    let best = null, bestScore = Infinity;
    for (const candidate of candidates) {
        const dx = candidate.x - origin.x, dz = candidate.z - origin.z, distance = Math.hypot(dx, dz);
        if (distance > reach + (candidate.radius || 0)) continue;
        let angle = Math.abs(Math.atan2(dx, dz) - yaw) % (Math.PI * 2);
        if (angle > Math.PI) angle = Math.PI * 2 - angle;
        // Anything close enough to touch counts, whichever way the player faces.
        if (angle > halfAngle && distance > 1.4) continue;
        const score = distance + angle * 1.5 - (candidate.bias || 0);
        if (score < bestScore) { best = candidate; bestScore = score; }
    }
    return best;
}
