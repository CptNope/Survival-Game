// Sky, sun, moon, stars and time-of-day lighting. One procedural dome (a single
// draw call, no textures) replaces the flat background colour. All colours are
// derived from the game clock and the weather, so they restore with a save.

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

const PALETTE = {
    day: { zenith: [.17, .42, .78], horizon: [.63, .79, .88] },
    dusk: { zenith: [.22, .25, .47], horizon: [.96, .56, .30] },
    night: { zenith: [.008, .016, .05], horizon: [.035, .06, .12] }
};
const OVERCAST = { clear: 0, rain: .62, storm: .88 };

// Clock time shown on the HUD: the day starts at 06:00 with sunrise.
export function clockTime(dayTime, dayLength = 300) {
    const minutes = Math.floor(((dayTime / dayLength) * 24 * 60 + 6 * 60) % (24 * 60));
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

// Pure description of the sky for a moment in time. No engine access, so it
// can be unit-tested and reused by the HUD.
export function skyState(dayTime, dayLength = 300, weather = 'clear') {
    const angle = dayTime / dayLength * Math.PI * 2;
    const elevation = Math.sin(angle); // +1 at noon, -1 at midnight
    const daylight = Math.max(0, elevation);
    const dayAmount = smooth((elevation + .08) / .38);
    const duskAmount = 1 - smooth(Math.abs(elevation) / .34);
    const overcast = OVERCAST[weather] ?? 0;

    let zenith = lerp3(PALETTE.night.zenith, PALETTE.day.zenith, dayAmount);
    let horizon = lerp3(PALETTE.night.horizon, PALETTE.day.horizon, dayAmount);
    zenith = lerp3(zenith, PALETTE.dusk.zenith, duskAmount * .7);
    horizon = lerp3(horizon, PALETTE.dusk.horizon, duskAmount * (1 - overcast * .8));
    // Rain clouds flatten and grey the whole sky.
    const grey = lerp(.05, weather === 'storm' ? .36 : .52, dayAmount);
    zenith = lerp3(zenith, [grey * .82, grey * .88, grey * .95], overcast);
    horizon = lerp3(horizon, [grey, grey * 1.04, grey * 1.08], overcast * .85);

    // Warm, low light at dawn and dusk; cool moonlight keeps nights readable.
    const sunColor = lerp3([1, .55, .28], [1, .97, .86], smooth(daylight / .45));
    const moonlight = smooth((-elevation - .02) / .3);
    return {
        angle, elevation, daylight, dayAmount, duskAmount, overcast, moonlight,
        zenith, horizon, sunColor,
        sunDirection: [-Math.cos(angle), Math.sin(angle), -.25],
        sunIntensity: daylight * 1.15 * (1 - overcast * .55),
        moonIntensity: moonlight * .3 * (1 - overcast * .5),
        ambientIntensity: (.31 + dayAmount * .37) * (1 - overcast * .18),
        starAmount: moonlight * (1 - overcast),
        cloudCover: lerp(.34, 1, overcast),
        cloudColor: lerp3([.07, .08, .12], lerp3([1, .98, .95], [.5, .52, .57], overcast), dayAmount),
        fogDensity: lerp(.0062, .0125, overcast)
    };
}

const VERTEX = `precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDirection;
void main(void) {
    vDirection = position;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const FRAGMENT = `precision highp float;
varying vec3 vDirection;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform vec3 cloudColor;
uniform float sunAmount;
uniform float moonAmount;
uniform float starAmount;
uniform float cloudCover;
uniform float flash;
uniform float time;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main(void) {
    vec3 d = normalize(vDirection);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 color = mix(horizon, zenith, pow(h, 0.5));

    // Stars: one faint point per cell of a coarse grid on the dome.
    vec3 grid = d * 90.0;
    vec3 cell = floor(grid);
    float seed = hash(cell.xy + cell.z * 17.0);
    float point = smoothstep(0.34, 0.0, length(fract(grid) - 0.5));
    float twinkle = 0.65 + 0.35 * sin(time * 1.7 + seed * 80.0);
    color += vec3(0.85, 0.9, 1.0) * step(0.972, seed) * point * twinkle * starAmount * smoothstep(0.02, 0.3, d.y);

    // Sun disc with a soft halo, and a pale moon opposite it.
    float sun = max(dot(d, sunDirection), 0.0);
    color += sunColor * (smoothstep(0.9990, 0.9996, sun) * 1.5 + pow(sun, 220.0) * 0.45 + pow(sun, 18.0) * 0.12) * sunAmount;
    float moon = max(dot(d, -sunDirection), 0.0);
    color += vec3(0.78, 0.84, 0.95) * (smoothstep(0.9993, 0.9996, moon) + pow(moon, 60.0) * 0.12) * moonAmount;

    // Drifting cloud layer; rain and storms close it over.
    vec2 uv = d.xz / (d.y + 0.32) * 1.5 + vec2(time * 0.008, time * 0.003);
    float cloud = noise(uv) * 0.55 + noise(uv * 2.3) * 0.30 + noise(uv * 5.1) * 0.15;
    float edge = 0.80 - cloudCover * 0.62;
    float cover = smoothstep(edge, edge + 0.20, cloud) * smoothstep(0.0, 0.2, d.y);
    color = mix(color, cloudColor, cover * 0.86);

    color += vec3(0.75, 0.8, 1.0) * flash;
    gl_FragColor = vec4(color, 1.0);
}`;

export class SkySystem {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.time = 0;
        this.flash = 0;
        this.nextLightning = 6;
        this.state = skyState(game.dayTime, game.dayLength);
        this.underwater = new BABYLON.Color3(.04, .19, .27);
        this.dome = null;
        this.material = null;
        try { this.createDome(); }
        catch (error) { console.warn('Sky dome unavailable, using a flat sky:', error); }
        this.update(0);
    }

    createDome() {
        BABYLON.Effect.ShadersStore.wildsSkyVertexShader = VERTEX;
        BABYLON.Effect.ShadersStore.wildsSkyFragmentShader = FRAGMENT;
        this.material = new BABYLON.ShaderMaterial('wilds-sky', this.scene, 'wildsSky', {
            attributes: ['position'],
            uniforms: ['worldViewProjection', 'zenith', 'horizon', 'sunDirection', 'sunColor', 'cloudColor',
                'sunAmount', 'moonAmount', 'starAmount', 'cloudCover', 'flash', 'time']
        });
        this.material.backFaceCulling = false;
        this.material.disableDepthWrite = true;
        this.dome = BABYLON.MeshBuilder.CreateSphere('sky-dome', {diameter: 900, segments: 12}, this.scene);
        this.dome.material = this.material;
        this.dome.infiniteDistance = true;
        this.dome.isPickable = false;
        this.dome.checkCollisions = false;
        this.dome.applyFog = false;
        this.dome.alwaysSelectAsActiveMesh = true;
        this.dome.renderingGroupId = 0;
    }

    // Storms throw the occasional flash of lightning with thunder close behind.
    updateLightning(dt, weather) {
        this.flash = Math.max(0, this.flash - dt * 3.2);
        if (weather !== 'storm') { this.nextLightning = 5 + Math.random() * 6; return; }
        this.nextLightning -= dt;
        if (this.nextLightning > 0) return;
        this.nextLightning = 7 + Math.random() * 11;
        this.flash = 1;
        const audio = this.game.audio;
        if (audio) setTimeout(() => audio.play('thunder'), 250 + Math.random() * 900);
    }

    update(dt) {
        const game = this.game;
        const weather = game.weatherSystem?.type || 'clear';
        this.time += dt;
        this.updateLightning(dt, weather);
        const s = this.state = skyState(game.dayTime, game.dayLength, weather);
        const sun = game.sunLight, ambient = game.ambientLight;
        const camera = game.playerSystem?.camera;

        // One directional light serves as the sun by day and the moon by night.
        const night = s.moonIntensity > s.sunIntensity;
        const sign = night ? -1 : 1;
        if (sun) {
            sun.direction.set(-s.sunDirection[0] * sign, -Math.max(.12, Math.abs(s.sunDirection[1])), -s.sunDirection[2] * sign);
            if (camera) sun.position.copyFrom(camera.position.subtract(sun.direction.scale(65)));
            sun.intensity = Math.max(s.sunIntensity, s.moonIntensity) + this.flash * .9;
            if (night) sun.diffuse.set(.55, .66, .95); else sun.diffuse.set(...s.sunColor);
        }
        if (ambient) {
            ambient.intensity = s.ambientIntensity + this.flash * .8;
            ambient.diffuse.set(lerp(.62, 1, s.dayAmount), lerp(.72, 1, s.dayAmount), 1);
            ambient.groundColor.set(lerp(.10, .30, s.dayAmount), lerp(.13, .32, s.dayAmount), lerp(.19, .26, s.dayAmount));
        }

        const submerged = Boolean(game.playerSystem?.isUnderwater);
        // Below the surface there is only murk: no sky, sun or clouds.
        if (this.dome && this.dome.isEnabled() === submerged) this.dome.setEnabled(!submerged);
        const fog = submerged ? this.underwater : new BABYLON.Color3(...s.horizon);
        this.scene.clearColor = new BABYLON.Color4(fog.r, fog.g, fog.b, 1);
        this.scene.fogColor = fog;
        this.scene.fogDensity = submerged ? .11 : s.fogDensity;

        if (this.material) {
            const m = this.material;
            m.setColor3('zenith', new BABYLON.Color3(...s.zenith));
            m.setColor3('horizon', new BABYLON.Color3(...s.horizon));
            m.setColor3('sunColor', new BABYLON.Color3(...s.sunColor));
            m.setColor3('cloudColor', new BABYLON.Color3(...s.cloudColor));
            m.setVector3('sunDirection', new BABYLON.Vector3(...s.sunDirection).normalize());
            m.setFloat('sunAmount', smooth((s.elevation + .1) / .2) * (1 - s.overcast));
            m.setFloat('moonAmount', s.moonlight * (1 - s.overcast));
            m.setFloat('starAmount', s.starAmount);
            m.setFloat('cloudCover', s.cloudCover);
            m.setFloat('flash', this.flash * .5);
            m.setFloat('time', this.time);
        }
    }
}
