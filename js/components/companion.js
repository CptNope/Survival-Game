import { DOG, STRAY, isThreat, chooseTarget, heelPoint, stepToward, sanitizeCompanion } from '../companion.js';
import { CREATURES } from '../creatures.js';
import { cellOf, isOpen, resolveCircle, lineOfSight } from '../dungeon.js';
import { createWolfModel } from '../models/wilderness.js';

// A stray turns up at your campfire; cooked meat makes it yours. After that it
// follows, defends you from whatever attacks, and comes underground with you.
export class CompanionSystem {
    constructor(game) {
        this.game = game;
        this.tamed = false;
        this.mode = 'follow';      // follow or stay
        this.health = DOG.health;
        this.down = 0;             // Seconds left on the ground.
        this.mesh = null;
        this.stray = null;         // {x, z} while one is waiting by the fire.
        this.biteIn = 0;
        this.calm = 0;
        this.lost = 0;
        this.gait = 0;
        this.strayCheck = 0;
        this.underground = false;
        this.placed = false;       // Has the dog been put somewhere in the world yet?
    }

    get position() { return this.mesh?.position || null; }

    ensureMesh() {
        if (this.mesh) return this.mesh;
        const model = createWolfModel(this.game.scene, 4242, [.56, .40, .24], [.82, .70, .50]);
        this.mesh = model.mesh;
        this.mesh.scaling.setAll(.78);
        this.mesh.isPickable = false;
        this.mesh.checkCollisions = false;
        this.game.registerModelShadow?.(this.mesh);
        return this.mesh;
    }

    ground(x, z) {
        const dungeon = this.game.dungeonSystem;
        return dungeon?.active ? dungeon.floorY : this.game.terrainSystem.getPerlinHeight(x, z);
    }

    place(x, z) {
        const mesh = this.ensureMesh();
        mesh.setEnabled(true);
        mesh.position.set(x, this.ground(x, z), z);
        this.placed = true;
    }

    // Put the dog at the player's side: after a teleport, a load, or a long sprint.
    toHeel() {
        const body = this.game.playerSystem.camera, dungeon = this.game.dungeonSystem;
        let spot = heelPoint(body.position, body.rotation.y);
        if (dungeon?.active && dungeon.layout) {
            const cell = cellOf(dungeon.layout, spot.x, spot.z);
            if (!isOpen(dungeon.layout, cell.x, cell.y)) spot = {x: body.position.x, z: body.position.z};
        } else if (this.game.terrainSystem.isWaterArea(spot.x, spot.z)) spot = {x: body.position.x, z: body.position.z};
        this.place(spot.x, spot.z);
        this.lost = 0;
    }

    // --- The stray ----------------------------------------------------------
    updateStray(dt) {
        const game = this.game, position = game.playerSystem.camera.position;
        if (this.stray) {
            if (game.dungeonSystem?.active || Math.hypot(position.x - this.stray.x, position.z - this.stray.z) > STRAY.forget) {
                this.stray = null;
                this.mesh?.setEnabled(false);
                this.placed = false;
                return;
            }
            // It sits and watches you.
            this.mesh.rotation.y = Math.atan2(position.x - this.stray.x, position.z - this.stray.z);
            return;
        }
        this.strayCheck -= dt;
        if (this.strayCheck > 0 || game.dungeonSystem?.active) return;
        this.strayCheck = 2;
        // It comes to a fire you built, while you are sitting at it.
        const fire = game.buildSystem.structures.find(item => item.type === 'fire' && Math.hypot(position.x - item.x, position.z - item.z) < STRAY.appear);
        if (!fire) return;
        for (let n = 0; n < 8; n++) {
            const angle = Math.atan2(fire.x - position.x, fire.z - position.z) + (n - 3.5) * .6;
            const x = fire.x + Math.sin(angle) * STRAY.sit, z = fire.z + Math.cos(angle) * STRAY.sit;
            if (game.terrainSystem.isWaterArea(x, z)) continue;
            this.stray = {x, z};
            this.place(x, z);
            game.uiSystem?.showNotification?.('A stray dog is watching your fire');
            game.audio?.play('growl', {volume: .35});
            return;
        }
    }

    tame() {
        const game = this.game, pack = game.inventorySystem.inventory;
        if (this.tamed || !this.stray || !(pack.cookedMeat > 0)) return false;
        pack.cookedMeat--;
        this.tamed = true;
        this.stray = null;
        this.health = DOG.health;
        this.mode = 'follow';
        game.audio?.play('discover');
        game.uiSystem?.showDayBanner?.('A friend', 'The dog will follow you and fight beside you · T tells it to stay', false, true);
        game.progression?.record('befriended');
        game.uiSystem?.updateInventoryUI?.();
        game.saveSystem?.save?.();
        return true;
    }

    // What E does next to the stray.
    interaction() {
        if (this.tamed || !this.stray || this.game.dungeonSystem?.active) return null;
        const position = this.game.playerSystem.camera.position;
        if (Math.hypot(position.x - this.stray.x, position.z - this.stray.z) > STRAY.reach) return null;
        return this.game.inventorySystem.inventory.cookedMeat > 0
            ? {label: 'Press E to offer the stray cooked meat', act: () => this.tame()}
            : {label: 'A stray dog · It wants cooked meat'};
    }

    toggleMode() {
        if (!this.tamed) return false;
        this.mode = this.mode === 'follow' ? 'stay' : 'follow';
        this.game.uiSystem?.showNotification?.(this.mode === 'stay' ? 'Your dog stays here' : 'Your dog comes to heel');
        this.game.audio?.play('click');
        return true;
    }

    // For the HUD chip: '' when there is no dog.
    status() {
        if (!this.tamed) return '';
        if (this.down > 0) return `Dog down · back in ${Math.ceil(this.down)}s`;
        return `Dog ${Math.ceil(this.health)}/${DOG.health} · ${this.mode === 'stay' ? 'Staying' : 'At heel'}`;
    }

    hurt(amount) {
        if (!this.tamed || this.down > 0) return;
        this.health -= amount;
        this.calm = DOG.calm;
        if (this.health > 0) return;
        this.health = 0;
        this.down = DOG.revive;
        this.game.uiSystem?.showNotification?.('Your dog is down · It will get back up');
        this.game.audio?.play('hurt');
    }

    // --- The tamed dog --------------------------------------------------------
    update(dt) {
        const game = this.game;
        if (game.paused) return;
        dt = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), .05);
        if (!this.tamed) { this.updateStray(dt); return; }
        const body = game.playerSystem.camera, player = body.position, dungeon = game.dungeonSystem;
        const underground = Boolean(dungeon?.active);
        const mesh = this.ensureMesh();
        // A change of world, or a first appearance: start at the player's side.
        if (underground !== this.underground || !this.placed) { this.underground = underground; this.toHeel(); }
        const dog = mesh.position;

        if (this.down > 0) {
            this.down -= dt;
            mesh.rotation.z = Math.PI / 2 * .9; // On its side.
            if (this.down <= 0) {
                this.down = 0;
                this.health = DOG.health * .5;
                mesh.rotation.z = 0;
                game.uiSystem?.showNotification?.('Your dog is back on its feet');
            }
            return;
        }
        mesh.rotation.z = 0;
        this.calm = Math.max(0, this.calm - dt);
        if (this.calm <= 0) this.health = Math.min(DOG.health, this.health + DOG.regen * dt);
        this.biteIn = Math.max(0, this.biteIn - dt);

        // Anything after the player, in this world, that the dog can reach.
        const threats = [];
        for (const animal of game.animalSystem.animals) {
            if (Boolean(animal.dungeon) !== underground || !isThreat(animal, CREATURES[animal.kind])) continue;
            const spot = animal.mesh.position;
            if (underground && !lineOfSight(dungeon.layout, dog.x, dog.z, spot.x, spot.z)) continue;
            threats.push({x: spot.x, z: spot.z, animal});
        }
        const target = chooseTarget(dog, player, threats);
        let goal, stopShort;
        if (target) { goal = target; stopShort = DOG.reach * .7; }
        else if (this.mode === 'stay') { goal = null; }
        else { goal = heelPoint(player, body.rotation.y); stopShort = .4; }

        // Too far behind, or out of sight underground for a while: catch up at once.
        const apart = Math.hypot(player.x - dog.x, player.z - dog.z);
        if (this.mode === 'follow' && !target) {
            const blocked = underground && !lineOfSight(dungeon.layout, dog.x, dog.z, player.x, player.z);
            this.lost = blocked ? this.lost + dt : 0;
            if (apart > DOG.leash || this.lost > 3) { this.toHeel(); return; }
        }

        if (goal) {
            const step = stepToward(dog, goal, DOG.speed * (target ? 1.15 : apart > 9 ? 1.4 : 1) * dt, stopShort);
            let x = step.x, z = step.z;
            if (underground) ({x, z} = resolveCircle(dungeon.layout, x, z, .5));
            else if (game.terrainSystem.isWaterArea(x, z)) { x = dog.x; z = dog.z; } // It will not swim.
            const moved = Math.hypot(x - dog.x, z - dog.z);
            dog.x = x; dog.z = z;
            if (step.heading !== null && (moved > .001 || target)) mesh.rotation.y = step.heading;
            this.gait += moved * 3.2;
        }
        dog.y = this.ground(dog.x, dog.z) + Math.abs(Math.sin(this.gait)) * .07;

        if (target && this.biteIn <= 0 && Math.hypot(target.x - dog.x, target.z - dog.z) <= DOG.reach) {
            const animal = target.animal, def = CREATURES[animal.kind] || {};
            this.biteIn = DOG.cooldown;
            this.calm = DOG.calm;
            animal.health -= DOG.damage;
            animal.fleeTimer = Math.max(animal.fleeTimer || 0, 5);
            animal.staggerTimer = .2;
            game.effects?.hitAnimal?.(animal, DOG.damage, null, false);
            game.audio?.play('hit', {volume: .5});
            // It does not always get away clean.
            if (animal.health > 0 && Math.random() < DOG.risk) this.hurt((def.damage || 8) * (animal.damageScale || 1) * DOG.share);
        }
    }

    capture() { return {tamed: this.tamed, health: this.health, mode: this.mode}; }

    restore(saved) {
        const clean = sanitizeCompanion(saved);
        this.tamed = clean.tamed; this.health = clean.health; this.mode = clean.mode;
        this.down = 0; this.stray = null; this.calm = 0; this.lost = 0;
        this.mesh?.setEnabled(false);
        this.placed = false; // Reappears at heel on the next update.
    }
}
