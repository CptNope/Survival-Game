// Procedural sound: every effect and ambience layer is synthesised with the
// Web Audio API. No audio files are downloaded, so the game stays small and
// fully playable offline. Without Web Audio (or before the first click, when
// browsers keep audio locked) every method is a silent no-op.

// name -> list of voices. Tone: {f, to, type, d, g, at}. Noise: {n: filter Hz, q, hp, d, g, at}.
export const SOUNDS = Object.freeze({
    chop: [{n: 900, q: 1.2, d: .09, g: .55}, {f: 150, to: 70, type: 'triangle', d: .12, g: .55}],
    timber: [{n: 500, q: .8, d: .45, g: .5}, {f: 110, to: 45, type: 'triangle', d: .4, g: .5}, {n: 2200, q: 2, d: .12, g: .25, at: .1}],
    mine: [{f: 1250, to: 820, type: 'square', d: .07, g: .16}, {n: 2600, q: 3, d: .06, g: .4}, {f: 190, to: 110, type: 'triangle', d: .08, g: .35}],
    pluck: [{n: 3200, q: 1.5, hp: true, d: .07, g: .3}, {f: 520, to: 760, type: 'sine', d: .07, g: .18}],
    collect: [{f: 620, to: 880, type: 'sine', d: .09, g: .22}, {f: 930, to: 1240, type: 'sine', d: .1, g: .18, at: .07}],
    craft: [{n: 1400, q: 2, d: .05, g: .3}, {f: 440, type: 'triangle', d: .1, g: .22, at: .05}, {f: 660, type: 'triangle', d: .14, g: .22, at: .13}],
    build: [{f: 120, to: 60, type: 'triangle', d: .16, g: .6}, {n: 700, q: 1, d: .12, g: .4}, {n: 1800, q: 2, d: .06, g: .25, at: .12}],
    place: [{f: 300, to: 380, type: 'sine', d: .05, g: .12}],
    deny: [{f: 190, to: 140, type: 'square', d: .12, g: .1}],
    click: [{f: 700, to: 560, type: 'sine', d: .04, g: .1}],
    whoosh: [{n: 900, q: .7, d: .16, g: .2}],
    hit: [{n: 500, q: .9, d: .1, g: .55}, {f: 210, to: 90, type: 'sawtooth', d: .1, g: .3}],
    hurt: [{f: 160, to: 70, type: 'sawtooth', d: .2, g: .34}, {n: 380, q: .8, d: .14, g: .4}],
    death: [{f: 220, to: 55, type: 'sawtooth', d: .9, g: .3}, {f: 110, to: 40, type: 'triangle', d: 1.1, g: .35}],
    eat: [{n: 1100, q: 2.5, d: .06, g: .3}, {n: 900, q: 2.5, d: .06, g: .28, at: .13}, {n: 1200, q: 2.5, d: .06, g: .25, at: .26}],
    drink: [{f: 320, to: 540, type: 'sine', d: .09, g: .2}, {f: 300, to: 520, type: 'sine', d: .09, g: .2, at: .16}, {f: 340, to: 580, type: 'sine', d: .09, g: .18, at: .32}],
    heal: [{f: 392, type: 'sine', d: .16, g: .16}, {f: 523, type: 'sine', d: .22, g: .16, at: .1}],
    sizzle: [{n: 4200, q: .8, hp: true, d: .55, g: .2}],
    splash: [{n: 1300, q: .6, d: .32, g: .45}, {n: 3200, q: 1, hp: true, d: .22, g: .2, at: .04}],
    step: [{n: 420, q: .8, d: .06, g: .16}],
    levelup: [{f: 523, type: 'triangle', d: .14, g: .2}, {f: 659, type: 'triangle', d: .14, g: .2, at: .11}, {f: 784, type: 'triangle', d: .14, g: .2, at: .22}, {f: 1047, type: 'triangle', d: .34, g: .22, at: .33}],
    discover: [{f: 440, type: 'sine', d: .22, g: .18}, {f: 554, type: 'sine', d: .22, g: .18, at: .12}, {f: 659, type: 'sine', d: .4, g: .2, at: .24}],
    quest: [{f: 587, type: 'triangle', d: .12, g: .18}, {f: 880, type: 'triangle', d: .3, g: .2, at: .1}],
    growl: [{f: 95, to: 70, type: 'sawtooth', d: .5, g: .22, vib: 28}, {n: 300, q: 1.5, d: .5, g: .16}],
    howl: [{f: 310, to: 470, type: 'sine', d: .55, g: .1}, {f: 470, to: 360, type: 'sine', d: 1.3, g: .1, at: .5}],
    thunder: [{n: 140, q: .5, d: 2.4, g: .9}, {n: 60, q: .6, d: 3, g: .8, at: .15}],
    sleep: [{f: 330, to: 220, type: 'sine', d: .9, g: .12}, {f: 247, to: 165, type: 'sine', d: 1.2, g: .12, at: .3}],
    bird: [{f: 2400, to: 3100, type: 'sine', d: .07, g: .05}, {f: 2900, to: 2300, type: 'sine', d: .09, g: .05, at: .1}, {f: 2600, to: 3300, type: 'sine', d: .06, g: .045, at: .24}]
});

export class AudioSystem {
    constructor(game, settings = {}) {
        this.game = game;
        this.volume = Number.isFinite(settings.volume) ? settings.volume : .7;
        this.muted = Boolean(settings.muted);
        this.context = null;
        this.master = null;
        this.noiseBuffer = null;
        this.layers = {};
        this.fireTimer = 0;
        this.birdTimer = 4;
        this.stepDistance = 0;
        this.lastPosition = null;
    }

    get supported() {
        return typeof globalThis.AudioContext === 'function' || typeof globalThis.webkitAudioContext === 'function';
    }

    // Browsers only allow audio after a gesture; called from the first click or tap.
    unlock() {
        if (!this.supported) return false;
        try {
            if (!this.context) {
                const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
                this.context = new Context();
                this.master = this.context.createGain();
                this.master.gain.value = this.muted ? 0 : this.volume;
                this.master.connect(this.context.destination);
                const length = this.context.sampleRate * 2;
                this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
                const data = this.noiseBuffer.getChannelData(0);
                for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
                this.startAmbience();
            }
            if (this.context.state === 'suspended') this.context.resume();
            return true;
        } catch (error) {
            console.warn('Audio unavailable:', error);
            this.context = null;
            return false;
        }
    }

    setVolume(value) {
        this.volume = Math.max(0, Math.min(1, Number(value) || 0));
        this.applyVolume();
    }
    setMuted(value) { this.muted = Boolean(value); this.applyVolume(); }
    applyVolume() {
        if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, .05);
    }
    // Silence everything while the tab is hidden or the game is paused.
    suspend() { if (this.context?.state === 'running') this.context.suspend(); }
    resume() { if (this.context?.state === 'suspended') this.context.resume(); }

    play(name, {volume = 1, pitch = 1} = {}) {
        const voices = SOUNDS[name];
        if (!voices || !this.context || this.muted || this.context.state !== 'running') return false;
        try {
            // A little pitch drift keeps repeated swings from sounding mechanical.
            const drift = pitch * (.94 + Math.random() * .12);
            for (const voice of voices) this.voice(voice, volume, drift);
            return true;
        } catch { return false; }
    }

    voice(v, volume, pitch) {
        const ctx = this.context;
        const start = ctx.currentTime + (v.at || 0);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(v.g * volume, start + Math.min(.012, v.d * .2));
        gain.gain.exponentialRampToValueAtTime(.0008, start + v.d);
        gain.connect(this.master);
        let source;
        if (v.n) {
            source = ctx.createBufferSource();
            source.buffer = this.noiseBuffer;
            source.loop = true;
            const filter = ctx.createBiquadFilter();
            filter.type = v.hp ? 'highpass' : 'bandpass';
            filter.frequency.value = v.n * pitch;
            filter.Q.value = v.q || 1;
            source.connect(filter); filter.connect(gain);
            source.start(start, Math.random() * 1.5);
        } else {
            source = ctx.createOscillator();
            source.type = v.type || 'sine';
            source.frequency.setValueAtTime(v.f * pitch, start);
            if (v.to) source.frequency.exponentialRampToValueAtTime(v.to * pitch, start + v.d);
            if (v.vib) {
                const lfo = ctx.createOscillator(), depth = ctx.createGain();
                lfo.frequency.value = v.vib; depth.gain.value = v.f * .18;
                lfo.connect(depth); depth.connect(source.frequency);
                lfo.start(start); lfo.stop(start + v.d + .05);
            }
            source.connect(gain);
            source.start(start);
        }
        source.stop(start + v.d + .05);
    }

    // Continuous beds: wind, rain, night insects and a nearby fire.
    startAmbience() {
        const ctx = this.context;
        const bed = (type, frequency, q) => {
            const source = ctx.createBufferSource();
            source.buffer = this.noiseBuffer; source.loop = true;
            const filter = ctx.createBiquadFilter();
            filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
            const gain = ctx.createGain(); gain.gain.value = 0;
            source.connect(filter); filter.connect(gain); gain.connect(this.master);
            source.start(0, Math.random());
            return {gain, filter};
        };
        this.layers.wind = bed('lowpass', 420, .4);
        this.layers.rain = bed('highpass', 2100, .3);
        this.layers.fire = bed('bandpass', 900, .6);
        // Crickets: a high tone gated by a fast pulse.
        const tone = ctx.createOscillator(); tone.type = 'sine'; tone.frequency.value = 4300;
        const pulse = ctx.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 17;
        const gate = ctx.createGain(); gate.gain.value = .5;
        const depth = ctx.createGain(); depth.gain.value = .5;
        const out = ctx.createGain(); out.gain.value = 0;
        pulse.connect(depth); depth.connect(gate.gain);
        tone.connect(gate); gate.connect(out); out.connect(this.master);
        tone.start(); pulse.start();
        this.layers.night = {gain: out};
    }

    setLayer(name, level) {
        const layer = this.layers[name];
        if (layer) layer.gain.gain.setTargetAtTime(level, this.context.currentTime, .6);
    }

    // Called a few times a second with the state of the world around the player.
    update(dt, world) {
        if (!this.context || this.context.state !== 'running') return;
        const rain = world.weather === 'storm' ? .2 : world.weather === 'rain' ? .11 : 0;
        const muffled = world.underwater ? .25 : 1;
        this.setLayer('rain', rain * muffled);
        this.setLayer('wind', (world.weather === 'storm' ? .2 : world.weather === 'rain' ? .1 : .045) * muffled
            + (world.flying ? .1 : 0));
        this.setLayer('night', world.night && !rain && !world.underwater ? .016 : 0);
        const fire = Number.isFinite(world.fireDistance) ? Math.max(0, 1 - world.fireDistance / 14) : 0;
        this.setLayer('fire', fire * .05);
        if (fire > .05) {
            this.fireTimer -= dt;
            if (this.fireTimer <= 0) {
                this.fireTimer = .12 + Math.random() * .5;
                this.voice({n: 1500 + Math.random() * 2500, q: 4, d: .03, g: .16 * fire}, 1, 1);
            }
        }
        if (!world.night && !rain && !world.underwater) {
            this.birdTimer -= dt;
            if (this.birdTimer <= 0) {
                this.birdTimer = 5 + Math.random() * 11;
                this.play('bird', {pitch: .8 + Math.random() * .5});
            }
        }
    }

    // Footsteps follow the distance actually covered on the ground.
    footsteps(position, grounded, wading) {
        if (!this.lastPosition) { this.lastPosition = {x: position.x, z: position.z}; return; }
        const moved = Math.hypot(position.x - this.lastPosition.x, position.z - this.lastPosition.z);
        this.lastPosition.x = position.x; this.lastPosition.z = position.z;
        if (!grounded || moved > 4) { this.stepDistance = 0; return; }
        this.stepDistance += moved;
        if (this.stepDistance >= 2.3) {
            this.stepDistance = 0;
            this.play(wading ? 'splash' : 'step', {volume: wading ? .25 : 1});
        }
    }
}
