import { BOW, drawAmount, drawPower, arrowDamage, segmentHit, aimVector, assistAim } from '../archery.js';
import { CREATURES } from '../creatures.js';
import { cellOf, isOpen } from '../dungeon.js';
import { createBowModel, createArrowModel } from '../models/wilderness.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const STUCK_SECONDS = 5;

// The bow: hold to draw, release to loose. Arrows are real projectiles that
// fly straight, stop at walls and ground, and strike the first creature met.
export class ArcherySystem {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.arrows = [];   // In flight.
        this.stuck = [];    // Spent, waiting to fade.
        this.drawing = false;
        this.drawStart = 0;
        this.readyAt = 0;
        this.bow = null;
        this.nocked = null;
        this.meter = typeof document !== 'undefined' ? document.getElementById('draw-meter') : null;
    }

    carried() { return this.game.inventorySystem.inventory; }

    // Why the bow cannot be drawn right now, or '' when it can.
    blockedReason() {
        const pack = this.carried();
        if (!(pack.bow > 0)) return 'Craft a bow first · 3 wood and 3 fiber';
        if (!(pack.arrows > 0)) return 'Out of arrows · Craft more from wood and stone';
        if (this.game.playerSystem.isSwimming) return 'You cannot draw a bow while swimming';
        return '';
    }

    // Seconds the current draw has been held, and how full it is (0..1).
    held() { return this.drawing ? (now() - this.drawStart) / 1000 : 0; }
    amount() { return this.drawing ? drawAmount(this.held()) : 0; }

    beginDraw() {
        const game = this.game;
        if (game.paused || game.playerSystem.isDead || game.buildSystem?.placing || this.drawing) return false;
        if (now() < this.readyAt) return false;
        const reason = this.blockedReason();
        if (reason) {
            game.uiSystem?.showNotification?.(reason);
            game.audio?.play('deny');
            return false;
        }
        this.drawing = true;
        this.drawStart = now();
        game.audio?.play('draw');
        this.showBow(true);
        return true;
    }

    cancel() {
        if (!this.drawing) return false;
        this.drawing = false;
        this.showBow(false);
        return true;
    }

    release() {
        if (!this.drawing) return false;
        const power = drawPower(this.held());
        this.drawing = false;
        this.showBow(false);
        if (this.game.paused || this.game.playerSystem.isDead || this.blockedReason()) return false;
        this.loose(power);
        return true;
    }

    // Living creatures in the player's realm, as points to aim for.
    targets() {
        const underground = Boolean(this.game.dungeonSystem?.active);
        return this.game.animalSystem.animals.filter(animal => animal.health > 0 && Boolean(animal.dungeon) === underground).map(animal => {
            const radius = CREATURES[animal.kind]?.radius || .7;
            return {x: animal.mesh.position.x, y: animal.mesh.position.y + radius * 1.1, z: animal.mesh.position.z, radius, animal};
        });
    }

    // Where an arrow starts and which way it goes, for the current view.
    aim() {
        const game = this.game, body = game.playerSystem.camera, view = game.viewSystem;
        const eye = body.position, yaw = body.rotation.y;
        const origin = {x: eye.x + Math.sin(yaw) * .5, y: eye.y - .25, z: eye.z + Math.cos(yaw) * .5};
        const targets = this.targets();
        let direction;
        if (view?.mode === 'overhead') {
            // No reticle from above: shoot at whatever is ahead, else straight on.
            const ahead = view.coneHit?.(BOW.range * .7);
            const target = ahead && targets.find(candidate => candidate.animal.mesh === ahead.pickedMesh);
            direction = target ? normal(target.x - origin.x, target.y - origin.y, target.z - origin.z) : aimVector(yaw, 0);
        } else if (view?.mode === 'third') {
            // Aim at the point the screen centre is looking at, from the player.
            const camera = view.camera, forward = camera.getDirection(BABYLON.Axis.Z), reach = 60;
            const hit = this.scene.pickWithRay(new BABYLON.Ray(camera.position, forward, reach));
            let point = hit?.hit && hit.pickedPoint ? hit.pickedPoint : null;
            // Something between the camera and the player's back is not a target.
            if (!point || (point.x - origin.x) * Math.sin(yaw) + (point.z - origin.z) * Math.cos(yaw) < 1.5)
                point = camera.position.add(forward.scale(reach));
            direction = normal(point.x - origin.x, point.y - origin.y, point.z - origin.z);
        } else {
            direction = aimVector(yaw, body.rotation.x);
        }
        return {origin, direction: assistAim(origin, direction, targets, BOW.range)};
    }

    damage(power) {
        const game = this.game;
        const bonus = (game.perks?.value('ranged') || 0) + ((game.buffs?.factor('damage') || 1) - 1);
        return arrowDamage(power, game.combatSystem.level, game.gear?.stat('power') || 0, bonus);
    }

    loose(power) {
        const game = this.game, pack = this.carried();
        const kept = Math.random() < (game.perks?.value('recover') || 0);
        if (!kept) pack.arrows--;
        const {origin, direction} = this.aim();
        const mesh = createArrowModel(this.scene);
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.position.set(origin.x, origin.y, origin.z);
        mesh.rotation.set(-Math.asin(Math.max(-1, Math.min(1, direction.y))), Math.atan2(direction.x, direction.z), 0);
        this.arrows.push({mesh, direction, speed: BOW.speed * (.55 + .45 * power), left: BOW.range * (.5 + .5 * power), damage: this.damage(power)});
        this.readyAt = now() + BOW.cooldown * 1000 / (game.buffs?.factor('speed') || 1);
        game.audio?.play('loose');
        game.progression?.record('arrows');
        game.uiSystem?.updateInventoryUI?.();
        if (pack.arrows === 0) game.uiSystem?.showNotification?.('That was your last arrow');
    }

    // True where an arrow cannot be: inside rock, below the ground, above a ceiling.
    blocked(x, y, z) {
        const dungeon = this.game.dungeonSystem;
        if (dungeon?.active && dungeon.layout) {
            if (y < dungeon.floorY || y > dungeon.floorY + (dungeon.ceiling || 4.4)) return true;
            const cell = cellOf(dungeon.layout, x, z);
            return !isOpen(dungeon.layout, cell.x, cell.y);
        }
        return y < this.game.terrainSystem.getPerlinHeight(x, z);
    }

    update(dt) {
        if (this.game.paused) return;
        dt = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), .05);
        this.poseBow();
        if (this.meter) {
            const amount = this.amount();
            this.meter.style.opacity = this.drawing ? '1' : '0';
            this.meter.firstElementChild.style.width = Math.round(amount * 100) + '%';
            this.meter.classList.toggle('full', amount >= .995);
        }
        if (this.drawing && (this.game.playerSystem.isDead || this.game.buildSystem?.placing)) this.cancel();
        const targets = this.arrows.length ? this.targets() : [];
        for (let i = this.arrows.length - 1; i >= 0; i--) {
            const arrow = this.arrows[i], from = arrow.mesh.position;
            const step = Math.min(arrow.left, arrow.speed * dt);
            const to = {x: from.x + arrow.direction.x * step, y: from.y + arrow.direction.y * step, z: from.z + arrow.direction.z * step};
            // The first creature along this step, if any.
            let struck = null, nearest = 2;
            for (const target of targets) {
                if (target.animal.health <= 0) continue;
                const t = segmentHit(from, to, target, target.radius + .3);
                if (t !== null && t < nearest) { nearest = t; struck = target; }
            }
            if (struck) {
                const critical = Math.random() * 100 < (this.game.gear?.stat('crit') || 0);
                const point = new BABYLON.Vector3(from.x + (to.x - from.x) * nearest, from.y + (to.y - from.y) * nearest, from.z + (to.z - from.z) * nearest);
                this.game.combatSystem.strike(struck.animal, arrow.damage * (critical ? 2 : 1), point, .85, critical);
                this.game.audio?.play('arrow');
                this.game.progression?.record('arrowHits');
                arrow.mesh.dispose(false, true);
                this.arrows.splice(i, 1);
                continue;
            }
            arrow.left -= step;
            if (this.blocked(to.x, to.y, to.z) || arrow.left <= 0) {
                // Spent: it stays where it stopped for a few seconds.
                if (arrow.left > 0) this.game.audio?.play('arrow', {volume: .5});
                this.stuck.push({mesh: arrow.mesh, left: STUCK_SECONDS});
                this.arrows.splice(i, 1);
                continue;
            }
            from.set(to.x, to.y, to.z);
        }
        for (let i = this.stuck.length - 1; i >= 0; i--) {
            const spent = this.stuck[i];
            spent.left -= dt;
            if (spent.left > 0) continue;
            spent.mesh.dispose(false, true);
            this.stuck.splice(i, 1);
        }
    }

    // --- The bow in hand --------------------------------------------------
    showBow(shown) {
        const game = this.game, first = !game.viewSystem || game.viewSystem.mode === 'first';
        if (shown && !this.bow) {
            this.bow = createBowModel(this.scene);
            this.nocked = createArrowModel(this.scene);
            for (const mesh of [this.bow, this.nocked]) {
                mesh.isPickable = false;
                mesh.checkCollisions = false;
                mesh.material.fogEnabled = false;
            }
            this.nocked.parent = this.bow;
        }
        if (!this.bow) return;
        this.bow.setEnabled(shown);
        if (!shown) { game.effects?.held?.setEnabled(game.effects.firstPerson); return; }
        const hand = first ? null : game.viewSystem?.avatar?.leftHand;
        this.bow.parent = first ? game.playerSystem.camera : hand || null;
        this.bow.renderingGroupId = this.nocked.renderingGroupId = first ? 1 : 0;
        // The tool in the other hand is put away while the bow is up.
        if (first) game.effects?.held?.setEnabled(false);
        this.poseBow();
    }

    poseBow() {
        if (!this.bow?.isEnabled()) return;
        const pull = this.amount();
        if (this.bow.parent === this.game.playerSystem.camera) {
            const side = this.game.effects?.sideScale?.() ?? 1;
            // Held out to the left and canted, as an archer holds it.
            this.bow.scaling.setAll(.3 * (.5 + .5 * side)); // Smaller on a narrow phone screen.
            this.bow.position.set(-.3 * side, -.08, 1.05);
            this.bow.rotation.set(0, .12, .3);
        } else {
            this.bow.scaling.setAll(.55);
            this.bow.position.set(0, 0, .12);
            this.bow.rotation.set(0, 0, 0);
        }
        this.nocked.position.set(0, 0, .12 - pull * .34); // Drawn back along the string.
    }

    dispose() {
        for (const arrow of [...this.arrows, ...this.stuck]) arrow.mesh.dispose(false, true);
        this.arrows = []; this.stuck = [];
    }
}

function normal(x, y, z) {
    const length = Math.hypot(x, y, z) || 1;
    return {x: x / length, y: y / length, z: z / length};
}
