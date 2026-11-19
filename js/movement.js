// How fast the player covers ground, in world units a second. One set of
// numbers for every way of steering, so a keyboard and a thumbstick walk at
// the same pace and creatures, the dog and the stride all agree with it.
export const SPEED = Object.freeze({walk: 6, sprint: 9.5, wade: 4.5, swim: 2.5});

// A frame longer than this is treated as this long, so a hitch is not a leap.
export const MAX_STEP_SECONDS = .05;

// The furthest the camera is pushed in one frame. Measured in the game: its
// collision check passes steps up to here almost whole (98%), loses a sixth of
// a 0.4 step and stops most of anything longer. So when frames come slowly
// the player slows down a little instead of sticking to the ground.
export const MAX_STEP_UNITS = .3;

const SQRT_TEN = Math.sqrt(10);
const share = inertia => 1 - Math.min(Math.max(Number.isFinite(inertia) ? inertia : 0, 0), .95);

// The camera carries `inertia` of each frame's push into the next, so a steady
// push of p a frame settles at p / (1 - inertia). Both helpers allow for that.

// Babylon's keyboard input moves the camera speed * frameFactor a frame, where
// frameFactor is sqrt(frame ms / (fps * 100)): speed * sqrt(10) a second.
export function frameFactor(frameMs, fps) {
    const value = Math.sqrt(frameMs / (fps * 100));
    return Number.isFinite(value) && value > 0 ? value : 0;
}

// The camera.speed that makes the keyboard travel at the pace asked for. Given
// this frame's factor, it also keeps the step within MAX_STEP_UNITS.
export function keyboardSpeed(unitsPerSecond, inertia = 0, factor = 0) {
    if (!Number.isFinite(unitsPerSecond) || unitsPerSecond <= 0) return 0;
    const speed = unitsPerSecond * share(inertia) / SQRT_TEN;
    return factor > 0 ? Math.min(speed, MAX_STEP_UNITS * share(inertia) / factor) : speed;
}

// How far to push the camera this frame to travel at the pace asked for.
export function frameStep(unitsPerSecond, seconds, inertia = 0) {
    if (!Number.isFinite(unitsPerSecond) || unitsPerSecond <= 0) return 0;
    const time = Math.min(Math.max(Number.isFinite(seconds) ? seconds : 0, 0), MAX_STEP_SECONDS);
    return Math.min(unitsPerSecond * time, MAX_STEP_UNITS) * share(inertia);
}
