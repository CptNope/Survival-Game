// Moment-to-moment feedback: debris bursts, struck-object shake, toppling
// trees, floating damage numbers, the hurt vignette, the tool held in view,
// firelight and the torch. Everything here is cosmetic; gameplay systems call
// it through optional chaining and work identically without it.
import { createAxeModel, createSpearModel, createTorchModel } from '../models/wilderness.js';

const DEBRIS = {
    wood: [[.52, .36, .2], [.33, .22, .13]],
    stone: [[.62, .64, .62], [.38, .4, .4]],
    ore: [[.72, .5, .3], [.6, .68, .72]],
    leaf: [[.4, .58, .26], [.25, .42, .2]],
    fur: [[.75, .6, .45], [.5, .34, .22]]
};
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class EffectsSystem {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.tweens = [];
        this.numbers = [];
        this.fires = new Map();
        this.heldKind = null;
        this.held = null;
        this.swingStart = -1e9;
        this.swingHeavy = false;
        this.torchLit = false;
        this.layer = document.getElementById('effects-layer');
        this.vignette = document.getElementById('hurt-vignette');
        this.reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
        this.createParticles();
        this.createLights();
        this.scene.onBeforeRenderObservable.add(() => this.update());
    }

    createParticles() {
        // A soft round dot drawn once; every burst and flame reuses it.
        const texture = new BABYLON.DynamicTexture('particle-dot', {width: 32, height: 32}, this.scene, false);
        const ctx = texture.getContext();
        const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(.55, 'rgba(255,255,255,.85)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32);
        texture.hasAlpha = true;
        texture.update();
        this.dot = texture;

        const debris = new BABYLON.ParticleSystem('debris', 160, this.scene);
        debris.particleTexture = texture;
        debris.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
        debris.emitter = new BABYLON.Vector3(0, -1000, 0);
        debris.minEmitBox = new BABYLON.Vector3(-.2, -.2, -.2);
        debris.maxEmitBox = new BABYLON.Vector3(.2, .2, .2);
        debris.minSize = .07; debris.maxSize = .2;
        debris.minLifeTime = .3; debris.maxLifeTime = .65;
        debris.minEmitPower = 1.6; debris.maxEmitPower = 4.2;
        debris.direction1 = new BABYLON.Vector3(-1.4, 1.2, -1.4);
        debris.direction2 = new BABYLON.Vector3(1.4, 3.4, 1.4);
        debris.gravity = new BABYLON.Vector3(0, -11, 0);
        debris.emitRate = 0;
        debris.manualEmitCount = 0;
        debris.start();
        this.debris = debris;
    }

    createLights() {
        // One warm light follows the nearest campfire; another is the torch.
        this.fireLight = new BABYLON.PointLight('fire-light', new BABYLON.Vector3(0, -1000, 0), this.scene);
        this.fireLight.diffuse = new BABYLON.Color3(1, .58, .24);
        this.fireLight.specular = BABYLON.Color3.Black();
        this.fireLight.range = 24;
        this.fireLight.setEnabled(false);
        this.torchLight = new BABYLON.PointLight('torch-light', new BABYLON.Vector3(0, -1000, 0), this.scene);
        this.torchLight.diffuse = new BABYLON.Color3(1, .72, .4);
        this.torchLight.specular = BABYLON.Color3.Black();
        this.torchLight.range = 30;
        this.torchLight.setEnabled(false);
    }

    burst(position, kind = 'wood', count = 10) {
        if (!position || !this.debris) return;
        const [a, b] = DEBRIS[kind] || DEBRIS.wood;
        this.debris.color1 = new BABYLON.Color4(...a, 1);
        this.debris.color2 = new BABYLON.Color4(...b, 1);
        this.debris.colorDead = new BABYLON.Color4(...b, 0);
        this.debris.emitter.copyFrom(position);
        this.debris.manualEmitCount = this.reducedMotion ? Math.ceil(count / 3) : count;
    }

    tween(duration, step, done) {
        this.tweens.push({start: now(), duration, step, done});
    }

    // A swing connecting with a tree, rock or plant.
    strike(obj, point, debris, finished) {
        this.swing('tool');
        this.burst(point, debris, finished ? 18 : 9);
        const mesh = obj.mesh;
        if (!mesh || finished || this.reducedMotion) return;
        const rest = obj.restRotation ?? (obj.restRotation = {x: mesh.rotation.x, z: mesh.rotation.z});
        this.tween(260, t => {
            if (mesh.isDisposed()) return;
            const wobble = Math.sin(t * Math.PI * 5) * (1 - t) * .045;
            mesh.rotation.x = rest.x + wobble; mesh.rotation.z = rest.z - wobble * .7;
        }, () => { if (!mesh.isDisposed()) { mesh.rotation.x = rest.x; mesh.rotation.z = rest.z; } });
    }

    // Trees lean over and sink away; smaller nodes shrink out. `release`
    // disposes the meshes once the animation has played.
    fell(obj, release) {
        const mesh = obj.mesh;
        if (!mesh || this.reducedMotion) { release(); return; }
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        const tree = obj.type === 'tree';
        const lean = (mesh.rotation.y % 2) - 1 >= 0 ? 1 : -1;
        const startY = mesh.position.y, startX = mesh.rotation.x;
        this.tween(tree ? 620 : 200, t => {
            if (mesh.isDisposed()) return;
            if (tree) {
                mesh.rotation.x = startX + lean * t * t * 1.35;
                mesh.position.y = startY - t * t * 1.4;
                if (t > .7) mesh.scaling.setAll(1 - (t - .7) / .3 * .85);
            } else mesh.scaling.setAll(1 - t * .95);
        }, release);
    }

    hitAnimal(animal, damage, point, critical = false) {
        const position = point || animal.mesh.position.add(new BABYLON.Vector3(0, animal.kind === 'rabbit' ? .4 : 1.2, 0));
        this.burst(position, animal.dungeon ? 'stone' : 'fur', critical ? 16 : 8);
        this.damageNumber(position, '-' + Math.round(damage) + (critical ? '!' : ''), critical ? 'damage crit' : 'damage');
    }

    // Floating text anchored to a point in the world.
    damageNumber(position, text, kind = 'damage') {
        if (!this.layer) return;
        const element = document.createElement('span');
        element.className = 'float-text ' + kind;
        element.textContent = text;
        this.layer.append(element);
        this.numbers.push({element, position: position.clone(), start: now()});
        if (this.numbers.length > 12) this.numbers.shift().element.remove();
    }

    hurt(amount) {
        const strong = amount >= 3;
        if (strong) this.game.audio?.play('hurt');
        if (!this.vignette) return;
        this.vignette.classList.remove('flash');
        void this.vignette.offsetWidth; // Restart the CSS animation.
        this.vignette.classList.add('flash');
        if (strong && !this.reducedMotion) {
            const canvas = this.game.engine.getRenderingCanvas();
            canvas.classList.remove('shake'); void canvas.offsetWidth; canvas.classList.add('shake');
        }
    }

    // --- Held tool -------------------------------------------------------
    bestHeld(preferred) {
        const inventory = this.game.inventorySystem?.inventory || {};
        const tool = inventory.ironTools > 0 ? 'ironTools' : inventory.tools > 0 ? 'tools' : null;
        if (preferred === 'spear' && inventory.spear > 0) return 'spear';
        return tool || (inventory.spear > 0 ? 'spear' : null);
    }

    refreshHeld(preferred = this.heldKind === 'spear' ? 'spear' : 'tool') {
        const kind = this.bestHeld(preferred);
        if (!this.game.inventorySystem?.inventory?.torch) this.setTorch(false);
        if (kind === this.heldKind) return;
        this.held?.dispose(false, true);
        this.held = null;
        this.heldKind = kind;
        const camera = this.game.playerSystem?.camera;
        if (!kind || !camera) return;
        const mesh = kind === 'spear' ? createSpearModel(this.scene) : createAxeModel(this.scene, kind === 'ironTools');
        mesh.name = 'held-' + kind;
        mesh.parent = camera;
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.renderingGroupId = 1; // Drawn over the world so it never clips into it.
        mesh.material.fogEnabled = false;
        this.heldScale = kind === 'spear' ? .34 : .62;
        this.held = mesh;
        this.poseHeld(0);
    }

    poseHeld(t) {
        const mesh = this.held;
        if (!mesh) return;
        // t runs 0..1 through the swing: a quick chop out and an eased return.
        const arc = t <= 0 || t >= 1 ? 0 : Math.sin(Math.min(1, t * 1.6) * Math.PI) * (this.swingHeavy ? 1.3 : 1);
        // On a tall phone screen the view is narrow, so bring the hands inward.
        const side = this.sideScale();
        mesh.scaling.setAll(this.heldScale * (.45 + .55 * side));
        if (this.heldKind === 'spear') {
            // Held low and level; a thrust drives it straight ahead.
            mesh.position.set(.3 * side, -.27, .62 + arc * .55);
            mesh.rotation.set(-.07, -.1, 0);
        } else {
            // Handle angled up from the lower right; the swing chops it forward.
            mesh.position.set((.34 - arc * .08) * side, -.26 - arc * .04, .7 + arc * .14);
            mesh.rotation.set(.3 + arc * 1.05, -.25, -.12);
        }
    }

    sideScale() {
        const camera = this.game.playerSystem?.camera;
        const aspect = camera ? this.game.engine.getAspectRatio(camera) : 1.6;
        return Math.max(.35, Math.min(1, aspect / 1.5));
    }

    swing(kind = 'tool', heavy = false) {
        this.refreshHeld(kind);
        this.swingStart = now();
        this.swingHeavy = heavy;
    }

    // --- Light -----------------------------------------------------------
    setTorch(lit) {
        const owned = this.game.inventorySystem?.inventory?.torch > 0;
        lit = Boolean(lit && owned);
        if (lit === this.torchLit) return lit;
        this.torchLit = lit;
        this.torchLight.setEnabled(lit);
        if (lit && !this.torchMesh) {
            const camera = this.game.playerSystem.camera;
            const mesh = createTorchModel(this.scene);
            mesh.parent = camera;
            mesh.isPickable = false;
            mesh.renderingGroupId = 1;
            mesh.material.fogEnabled = false;
            mesh.material.emissiveColor = new BABYLON.Color3(.5, .32, .14);
            mesh.scaling.setAll(.42);
            mesh.position.set(-.4, -.27, .8);
            mesh.rotation.set(.25, 0, .18);
            this.torchMesh = mesh;
        }
        this.torchMesh?.setEnabled(lit);
        return lit;
    }

    toggleTorch() {
        if (!(this.game.inventorySystem?.inventory?.torch > 0)) {
            this.game.uiSystem?.showNotification('Craft a torch first: 1 wood + 1 fiber');
            return false;
        }
        const lit = this.setTorch(!this.torchLit);
        this.game.audio?.play(lit ? 'sizzle' : 'click', {volume: .6});
        this.game.uiSystem?.showNotification(lit ? 'Torch lit' : 'Torch put away');
        return lit;
    }

    createFlame() {
        const flame = new BABYLON.ParticleSystem('campfire-flame', 60, this.scene);
        flame.particleTexture = this.dot;
        flame.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
        flame.minEmitBox = new BABYLON.Vector3(-.28, 0, -.28);
        flame.maxEmitBox = new BABYLON.Vector3(.28, .1, .28);
        flame.color1 = new BABYLON.Color4(1, .72, .22, 1);
        flame.color2 = new BABYLON.Color4(1, .38, .1, 1);
        flame.colorDead = new BABYLON.Color4(.35, .08, .02, 0);
        flame.minSize = .28; flame.maxSize = .7;
        flame.minLifeTime = .35; flame.maxLifeTime = .9;
        flame.emitRate = this.reducedMotion ? 14 : 38;
        flame.direction1 = new BABYLON.Vector3(-.25, 1.4, -.25);
        flame.direction2 = new BABYLON.Vector3(.25, 2.6, .25);
        flame.minEmitPower = .5; flame.maxEmitPower = 1.1;
        flame.gravity = new BABYLON.Vector3(0, .6, 0);
        return flame;
    }

    // Flames on the campfires around the player, and the single firelight.
    updateFires() {
        const build = this.game.buildSystem, camera = this.game.playerSystem?.camera;
        if (!build || !camera) return;
        const position = camera.position;
        // Underground the fires are the braziers; above, the player's campfires.
        const dungeon = this.game.dungeonSystem;
        const fires = dungeon?.active ? dungeon.braziers : build.structures.filter(item => item.type === 'fire');
        const near = fires
            .map(item => ({item, distance: Math.hypot(item.x - position.x, item.z - position.z)}))
            .filter(entry => entry.distance < 55)
            .sort((a, b) => a.distance - b.distance).slice(0, 3);
        const wanted = new Set(near.map(entry => entry.item.id));
        for (const [id, flame] of this.fires) {
            if (!wanted.has(id)) { flame.dispose(); this.fires.delete(id); }
        }
        for (const {item} of near) {
            if (this.fires.has(item.id)) continue;
            const flame = this.createFlame();
            flame.emitter = new BABYLON.Vector3(item.x, item.y + .4, item.z);
            flame.start();
            this.fires.set(item.id, flame);
        }
        const closest = near[0];
        this.nearestFireDistance = closest ? closest.distance : Infinity;
        const lit = Boolean(closest && closest.distance < 40);
        if (lit !== this.fireLight.isEnabled()) this.fireLight.setEnabled(lit);
        if (lit) this.fireLight.position.set(closest.item.x, closest.item.y + 1.3, closest.item.z);
    }

    update() {
        const time = now();
        // Tweens
        for (let i = this.tweens.length - 1; i >= 0; i--) {
            const tween = this.tweens[i];
            const t = Math.min(1, (time - tween.start) / tween.duration);
            tween.step(t);
            if (t >= 1) { this.tweens.splice(i, 1); tween.done?.(); }
        }
        // Held tool swing and idle sway
        if (this.held) this.poseHeld((time - this.swingStart) / (this.swingHeavy ? 420 : 300));
        // Firelight flicker; the torch brightens as daylight fades.
        const flicker = .85 + Math.sin(time * .013) * .08 + Math.sin(time * .031) * .07;
        const dark = 1 - (this.game.skySystem?.state.dayAmount ?? 1) * .75;
        if (this.fireLight.isEnabled()) this.fireLight.intensity = 1.5 * flicker * dark;
        if (this.torchLit) {
            const camera = this.game.playerSystem.camera;
            if (this.torchMesh) this.torchMesh.position.x = -.4 * this.sideScale();
            this.torchLight.position.copyFrom(camera.position);
            this.torchLight.intensity = 1.15 * flicker * dark;
        }
        // Floating numbers
        if (this.numbers.length) this.updateNumbers(time);
    }

    updateNumbers(time) {
        const engine = this.game.engine, camera = this.game.playerSystem.camera;
        const width = engine.getRenderWidth(), height = engine.getRenderHeight();
        const canvas = engine.getRenderingCanvas();
        const scale = canvas.clientWidth / width;
        const viewport = camera.viewport.toGlobal(width, height);
        const transform = this.scene.getTransformMatrix();
        for (let i = this.numbers.length - 1; i >= 0; i--) {
            const item = this.numbers[i];
            const t = (time - item.start) / 800;
            if (t >= 1) { item.element.remove(); this.numbers.splice(i, 1); continue; }
            const screen = BABYLON.Vector3.Project(item.position, BABYLON.Matrix.IdentityReadOnly, transform, viewport);
            const visible = screen.z > 0 && screen.z < 1;
            item.element.style.opacity = visible ? String(1 - t * t) : '0';
            item.element.style.transform =
                `translate(${screen.x * scale}px, ${screen.y * scale - t * 46}px) translate(-50%, -50%)`;
        }
    }
}
