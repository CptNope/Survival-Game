// How the explorer's body moves, as numbers: the size of each part, how a
// stride is timed, and the angle of every joint for what the player is doing.
// Pure maths, no engine. The model (models/avatar.js) builds the parts and the
// view (components/view.js) eases the joints toward these angles.
//
// Conventions, matching the engine: the body faces +z; a negative angle on a
// shoulder, elbow or hip swings that limb forward, a positive knee angle folds
// the shin back; positive torso pitch leans forward.

// Lengths in metres before `scale`. Feet are at 0.
export const AVATAR = Object.freeze({
    scale: 1.08,
    hips: .95,          // Height of the pelvis joint.
    hipWidth: .105,     // Each leg sits this far from the centre line.
    thigh: .42,
    shin: .51,          // Knee to the sole of the boot.
    spine: .13,         // Pelvis joint up to the waist joint.
    neck: .48,          // Waist joint up to the neck joint.
    shoulderWidth: .268,
    shoulderHeight: .385, // Above the waist joint.
    upperArm: .3,
    forearm: .32        // Elbow to the palm.
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (from, to, value) => { const t = clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };

// Move a value toward a target at a rate that does not depend on frame rate.
export function ease(current, target, rate, dt) {
    if (!(dt > 0)) return current;
    return current + (target - current) * (1 - Math.exp(-rate * dt));
}

// Turn this frame's movement into a walk: how fast, which way the hips face
// and how far the stride has advanced. `forward` and `right` are metres per
// second relative to where the body faces.
export function gait(state, forward, right, dt, moving = true) {
    const next = {...state};
    next.forward = ease(state.forward || 0, forward, 12, dt);
    next.right = ease(state.right || 0, right, 12, dt);
    const speed = Math.hypot(next.forward, next.right);
    const striding = moving && speed > .5;
    // Walking backwards steps backwards: the cycle runs in reverse and the hips stay square.
    const backwards = next.forward < -.35 && -next.forward > Math.abs(next.right) * .6;
    const turn = !striding ? 0 : backwards ? Math.atan2(-next.right, -next.forward) : Math.atan2(next.right, Math.max(0, next.forward));
    next.speed = speed;
    next.backwards = striding && backwards;
    next.turn = ease(state.turn || 0, clamp(turn, -1, 1), 10, dt);
    next.stride = ease(state.stride || 0, striding ? clamp(.45 + speed * .065, 0, 1) : 0, striding ? 10 : 7, dt);
    // Longer steps at speed, so a sprint is not a blur of tiny ones.
    const step = .8 + speed * .1, cycles = clamp(speed / (2 * step), 0, 2.5);
    next.phase = (state.phase || 0) + (striding ? (backwards ? -1 : 1) * cycles * Math.PI * 2 * dt : 0);
    return next;
}

// The attack, from 0 (started) to 1 (over): raise, strike, recover.
export function attackCurve(t) {
    if (!(t >= 0 && t < 1)) return {raise: 0, strike: 0};
    const down = smooth(.22, .42, t);
    return {raise: smooth(0, .2, t) * (1 - down), strike: down * (1 - smooth(.6, 1, t))};
}

// Joint angles for one moment. Everything is a target; the view eases toward it.
//   phase, stride, speed, turn   from gait()
//   time                         seconds, for breathing and swimming strokes
//   grounded, swimming, flying, dodging
//   attack                       0..1 through a swing, or null
//   heavy                        a heavy sweep swings wider
//   held                         'tools' | 'ironTools' | 'spear' | null (right hand)
//   torch                        lit torch in the left hand
//   draw                         0..1 bow drawn, or null
//   look                         camera pitch, positive looking down
export function avatarPose(input = {}) {
    const {phase = 0, stride = 0, speed = 0, turn = 0, time = 0, grounded = true, swimming = false, flying = false,
        dodging = false, attack = null, heavy = false, held = null, torch = false, draw = null, look = 0} = input;
    const run = clamp((speed - 6.5) / 4, 0, 1) * stride;
    const swing = stride * (.5 + run * .16);
    const breath = Math.sin(time * 1.7);
    const pose = {
        hipsY: stride * (.028 * Math.cos(phase * 2) - .02) + breath * .004 * (1 - stride),
        hipsYaw: turn,
        torsoPitch: stride * .05 + run * .14 + breath * .012 * (1 - stride),
        // The chest turns against the hips, and back toward where the player is looking.
        torsoYaw: -turn * .7 - Math.sin(phase) * stride * .14,
        headYaw: -turn * .3 + Math.sin(phase) * stride * .08,
        headPitch: clamp(look, -.9, .9) * .55 - stride * .04 - run * .1,
        legs: [], arms: []
    };
    for (let side = 0; side < 2; side++) {
        const p = phase + side * Math.PI, lift = Math.max(0, Math.cos(p));
        pose.legs.push({
            hip: -Math.sin(p) * swing - run * .12,
            // The knee folds as the leg swings through, gives a little as it lands,
            // and the trailing leg bends as it pushes off.
            knee: .05 + stride * (.1 + (.85 + run * .55) * lift * lift + .12 * Math.max(0, Math.sin(p)) + (.16 + run * .3) * Math.max(0, -Math.sin(p)))
        });
        pose.arms.push({
            shoulder: Math.sin(p) * swing * .75,
            spread: .07 + breath * .012 * (1 - stride),
            elbow: -(.14 + stride * .18 + run * .95 + Math.max(0, -Math.sin(p)) * stride * .3),
            hand: null // Total tilt of whatever is carried; null lets the hand follow the forearm.
        });
    }
    if (dodging) {
        pose.hipsY -= .2; pose.torsoPitch += .4; pose.headPitch -= .25;
        pose.legs.forEach((leg, side) => { leg.hip = side ? -.9 : -.35; leg.knee = side ? 1.3 : 1; });
        pose.arms.forEach(arm => { arm.shoulder = .5; arm.elbow = -.9; arm.spread = .3; });
    } else if (swimming) {
        const stroke = time * 4.2;
        pose.torsoPitch = 0; pose.headPitch = -.6; pose.hipsY = 0;
        pose.legs.forEach((leg, side) => { const kick = Math.sin(time * 9 + side * Math.PI); leg.hip = kick * .32; leg.knee = .2 + Math.max(0, kick) * .35; });
        pose.arms.forEach((arm, side) => { const reach = Math.sin(stroke + side * Math.PI); arm.shoulder = -2 + reach * .95; arm.elbow = -.25 - Math.max(0, -reach) * .7; arm.spread = .18; });
    } else if (flying) {
        pose.torsoPitch = .05; pose.headPitch = -.35; pose.hipsY = 0;
        pose.legs.forEach((leg, side) => { leg.hip = .22 + side * .14 + breath * .03; leg.knee = .3 + side * .2; });
        pose.arms.forEach(arm => { arm.shoulder = .45 + breath * .04; arm.elbow = -.3; arm.spread = .42; });
    } else if (!grounded) {
        // In the air: one knee up, arms out for balance.
        pose.torsoPitch = .08; pose.hipsY = 0;
        pose.legs.forEach((leg, side) => { leg.hip = side ? .18 : -.55; leg.knee = side ? .55 : .95; });
        pose.arms.forEach((arm, side) => { arm.shoulder = side ? .35 : -.4; arm.elbow = -.5; arm.spread = .45; });
    }
    const left = pose.arms[0], right = pose.arms[1], upright = !swimming && !dodging;
    // Whatever is carried keeps its own tilt, so a torch stays upright through a
    // jump or a dodge; standing or walking, it also changes how the arm hangs.
    if (torch) left.hand = .15;
    if (held) right.hand = held === 'spear' ? -.12 : .5;
    if (torch && upright) { left.shoulder = -.6 + left.shoulder * .2; left.elbow = -1.05; left.spread = .22; }
    if (held === 'spear' && upright) { right.shoulder = -.1 + right.shoulder * .35; right.elbow = -.4; }
    else if (held && upright) { right.shoulder = -.12 + right.shoulder * .3; right.elbow = -.95; }
    if (draw !== null && upright) {
        // Bow arm straight out, string hand back to the cheek.
        const pull = clamp(draw, 0, 1);
        left.shoulder = -1.5; left.elbow = -.06; left.spread = .1; left.hand = 0;
        right.shoulder = -1.42; right.elbow = -1.1 - pull * 1.15; right.spread = .3; right.hand = null;
        pose.torsoYaw += .12; pose.headYaw -= .12; pose.torsoPitch *= .4;
    } else if (attack !== null && !swimming) {
        const {raise, strike} = attackCurve(attack), rest = 1 - raise - strike, reach = heavy ? 1.2 : 1;
        if (held === 'spear' || !held) {
            // A thrust (or a punch): cocked back at the hip, then driven straight out.
            right.shoulder = right.shoulder * rest + .35 * raise - 1.3 * reach * strike;
            right.elbow = right.elbow * rest - 1.7 * raise - .12 * strike;
            if (held) right.hand = -.12 * rest - .05 * (raise + strike);
            pose.torsoYaw += .32 * raise - .3 * reach * strike;
            pose.torsoPitch += .16 * strike;
        } else {
            // A chop: up over the shoulder and down through the target.
            right.shoulder = right.shoulder * rest - 2.5 * reach * raise - .75 * strike;
            right.elbow = right.elbow * rest - 1.5 * raise - .3 * strike;
            right.hand = .5 * rest - .95 * raise + 1.35 * strike;
            pose.torsoYaw += .28 * raise - .26 * reach * strike;
            pose.torsoPitch += -.08 * raise + .24 * reach * strike;
        }
        right.spread = .12 + .1 * raise;
    }
    return pose;
}
