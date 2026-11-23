// Hostile creature behaviour, shared by surface threats (boar, bear) and
// everything that lives in the dungeons. Each creature has a "brain" that
// decides where it wants to go and when it attacks; every attack is
// telegraphed by a wind-up so it can be read and dodged.
import { CREATURES } from '../creatures.js';
import { GRID, cellOf, centreOf, isOpen, lineOfSight, resolveCircle } from '../dungeon.js';
import { RAID_SIGHT } from '../raids.js';

const BOLT_SPEED = 9.5;

export class CreatureAI {
    constructor(game) {
        this.game = game;
        this.bolts = [];
        this.boltMaterial = null;
    }

    layout() {
        const dungeon = this.game.dungeonSystem;
        return dungeon?.active ? dungeon.layout : null;
    }

    // Direction (unit x,z) a creature should walk to reach the player.
    pathDirection(animal, target, layout, sees) {
        const position = animal.mesh.position;
        let dx = target.x - position.x, dz = target.z - position.z;
        if (layout && !sees) {
            // No clear line: follow the flow field one cell at a time.
            const flow = this.game.dungeonSystem.flow;
            const cell = cellOf(layout, position.x, position.z);
            let best = null;
            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const x = cell.x + ox, y = cell.y + oy;
                if (!isOpen(layout, x, y)) continue;
                const value = flow ? flow[y * GRID + x] : -1;
                if (value >= 0 && (!best || value < best.value)) best = {x, y, value};
            }
            if (best) {
                const centre = centreOf(layout, best.x, best.y);
                dx = centre.x - position.x; dz = centre.z - position.z;
            }
        }
        const length = Math.hypot(dx, dz) || 1;
        return {x: dx / length, z: dz / length};
    }

    move(animal, vx, vz, dt, layout, def) {
        const position = animal.mesh.position;
        const knockScale = def.boss ? .12 : 1;
        const knockX = (animal.knockX || 0) * knockScale, knockZ = (animal.knockZ || 0) * knockScale;
        animal.knockX = (animal.knockX || 0) * Math.max(0, 1 - dt * 7);
        animal.knockZ = (animal.knockZ || 0) * Math.max(0, 1 - dt * 7);
        let x = position.x + (vx + knockX) * dt, z = position.z + (vz + knockZ) * dt;
        if (layout) {
            ({x, z} = resolveCircle(layout, x, z, def.radius));
        } else if (this.game.terrainSystem.isWaterArea(x, z)) {
            animal.heading = (animal.heading || 0) + Math.PI * .75;
            return false;
        }
        position.x = x; position.z = z;
        return true;
    }

    hurtPlayer(animal, def, amount = def.damage) {
        const player = this.game.playerSystem;
        if (player.isDead) return;
        const before = player.health;
        player.takeDamage(amount * (animal.damageScale || 1), def.cause);
        if (player.health >= before) return; // Dodged: nothing else lands either.
        if (def.venom) player.poison?.(def.venom.rate, def.venom.seconds);
        if (def.chill && this.game.survivalSystem) this.game.survivalSystem.cold = Math.min(100, this.game.survivalSystem.cold + def.chill);
    }

    update(animal, dt) {
        const def = CREATURES[animal.kind];
        const game = this.game, player = game.playerSystem;
        const target = player.camera.position, position = animal.mesh.position;
        const layout = this.layout();
        const dx = target.x - position.x, dz = target.z - position.z;
        const distance = Math.hypot(dx, dz);
        // A pack on the hunt keeps your scent from much further off.
        const sees = !player.isDead && distance < (animal.raid ? RAID_SIGHT : def.aggro)
            && (!layout || lineOfSight(layout, position.x, position.z, target.x, target.z));

        animal.fleeTimer = Math.max(0, (animal.fleeTimer || 0) - dt); // Set when struck: a provoked creature comes for you.
        animal.staggerTimer = Math.max(0, (animal.staggerTimer || 0) - dt);
        animal.timer = Math.max(0, (animal.timer || 0) - dt);
        animal.clock = (animal.clock || 0) + dt;
        if (sees || animal.fleeTimer > 0) animal.alert = layout ? 6 : 4;
        else animal.alert = Math.max(0, (animal.alert || 0) - dt);
        const hunting = animal.alert > 0 && !player.isDead;
        if (hunting && !animal.alerted) {
            animal.alerted = true;
            game.audio?.play(def.sound, {volume: Math.max(.3, 1 - distance / 24)});
            if (def.boss) game.dungeonSystem?.onBossAwake?.(animal);
        } else if (!hunting) animal.alerted = false;

        const staggered = animal.staggerTimer > 0 && !def.boss;
        const face = Math.atan2(dx, dz);
        let vx = 0, vz = 0, speed = 0;
        const state = animal.state || 'roam';

        if (state === 'windup') {
            // Rear back while the blow is coming, then land it if still in reach.
            animal.mesh.rotation.y = face;
            if (animal.timer <= 0) {
                animal.state = 'recover';
                animal.timer = def.cooldown * (animal.enraged ? .7 : 1);
                this.strike(animal, def, distance, layout);
            }
        } else if (state === 'dash') {
            // Committed to a straight line: a boar's charge or a spider's lunge.
            speed = animal.dashSpeed;
            vx = animal.dashX * speed; vz = animal.dashZ * speed;
            if (!animal.dashHit && distance < def.reach) { animal.dashHit = true; this.hurtPlayer(animal, def); }
            if (animal.timer <= 0) { animal.state = 'recover'; animal.timer = def.cooldown; }
        } else if (!hunting) {
            // Roam: amble about, pausing now and then.
            animal.turnTimer = (animal.turnTimer || 0) - dt;
            if (animal.turnTimer <= 0) {
                animal.heading = Math.random() * Math.PI * 2;
                animal.turnTimer = 2 + Math.random() * 4;
                animal.resting = Math.random() < .45;
            }
            speed = animal.resting || def.brain === 'boss' ? 0 : def.speed * .3;
            vx = Math.sin(animal.heading || 0) * speed; vz = Math.cos(animal.heading || 0) * speed;
            animal.state = 'roam';
        } else if (!staggered) {
            const direction = this.pathDirection(animal, target, layout, sees);
            const ready = state !== 'recover' || animal.timer <= 0;
            if (state === 'recover' && animal.timer <= 0) animal.state = 'chase';
            speed = def.speed * (animal.enraged ? 1.45 : 1);
            if (def.brain === 'caster') {
                // Keep a distance and throw bolts down clear corridors.
                if (distance < def.keep) { direction.x = -direction.x; direction.z = -direction.z; }
                else if (sees && distance < def.reach) speed = 0;
                if (ready && sees && distance < def.reach) this.beginWindup(animal, def);
            } else if (def.brain === 'flyer') {
                // Weave towards the player instead of flying a straight line.
                const weave = Math.sin(animal.clock * 5 + animal.seed) * .8;
                const wx = direction.x - direction.z * weave, wz = direction.z + direction.x * weave;
                if (state === 'recover') { direction.x = -wx; direction.z = -wz; } else { direction.x = wx; direction.z = wz; }
                if (ready && distance < def.reach) this.beginWindup(animal, def);
            } else if ((def.brain === 'lunger' || def.brain === 'charger') && ready && sees
                && distance < (def.brain === 'charger' ? 16 : 6.5) && distance > def.reach) {
                // Lunge or charge along the line to where the player is now.
                animal.state = 'dash';
                animal.timer = def.brain === 'charger' ? 1.25 : .34;
                animal.dashSpeed = def.charge || def.lunge;
                animal.dashX = direction.x; animal.dashZ = direction.z; animal.dashHit = false;
                game.audio?.play(def.sound, {volume: .7});
                speed = 0;
            } else if (ready && distance < def.reach * .82) {
                this.beginWindup(animal, def);
                speed = 0;
            } else if (state === 'recover') speed *= .35;
            if (distance < def.reach * .55 && def.brain !== 'caster' && def.brain !== 'flyer') speed = 0;
            vx = direction.x * speed; vz = direction.z * speed;
            if (!animal.state || animal.state === 'roam') animal.state = 'chase';
        }

        if (vx || vz || animal.knockX || animal.knockZ) this.move(animal, vx, vz, dt, layout, def);
        if (hunting || animal.state === 'dash') animal.mesh.rotation.y = animal.state === 'dash' ? Math.atan2(animal.dashX, animal.dashZ) : face;
        else if (speed > 0) animal.mesh.rotation.y = animal.heading || 0;

        // Height, bob and the lean of a wind-up.
        const ground = layout ? this.game.dungeonSystem.floorY : this.game.terrainSystem.getPerlinHeight(position.x, position.z);
        const hover = def.hover ? def.hover + Math.sin(animal.clock * (def.brain === 'flyer' ? 9 : 2.2) + animal.seed) * (def.brain === 'flyer' ? .22 : .12) : 0;
        position.y = ground + hover;
        const windup = animal.state === 'windup' ? 1 - animal.timer / def.windup : 0;
        animal.mesh.rotation.x = animal.state === 'windup' ? -.32 * windup : animal.state === 'dash' ? .18 : 0;
        if (def.brain === 'flyer') animal.mesh.scaling.x = 1 + Math.sin(animal.clock * 22) * .22;
        else if (!def.hover && speed > 0) position.y += Math.abs(Math.sin(animal.clock * speed * 2.4)) * .07;

        // The boss calls for help once, at half health.
        if (def.boss && !animal.enraged && animal.health < animal.maxHealth * .5) {
            animal.enraged = true;
            game.audio?.play('roar');
            game.uiSystem?.showNotification?.('The Stone Warden is enraged!');
            game.dungeonSystem?.summonAround?.(animal, 'spider', 2);
        }
    }

    beginWindup(animal, def) {
        animal.state = 'windup';
        animal.timer = def.windup;
        if (def.brain === 'boss' || def.brain === 'caster') this.game.audio?.play(def.brain === 'boss' ? 'growl' : 'wail', {volume: .6});
    }

    // The moment a wound-up attack lands.
    strike(animal, def, distance, layout) {
        const game = this.game;
        if (def.brain === 'caster') {
            // A volley fans out either side of the aimed bolt.
            const shots = def.volley || 1;
            for (let n = 0; n < shots; n++) this.fireBolt(animal, def, (n - (shots - 1) / 2) * .3);
            return;
        }
        if (def.brain === 'boss') {
            game.audio?.play('slam');
            game.effects?.burst?.(animal.mesh.position.add(new BABYLON.Vector3(0, .3, 0)), 'stone', 28);
            if (distance < def.reach) this.hurtPlayer(animal, def);
            else if (distance < def.reach * 2.2) game.effects?.hurt?.(1); // Close enough to feel it.
            return;
        }
        if (distance < def.reach * 1.2) this.hurtPlayer(animal, def);
    }

    fireBolt(animal, def, spread = 0) {
        const scene = this.game.scene, target = this.game.playerSystem.camera.position;
        const from = animal.mesh.position;
        // One glowing material per colour of bolt: wraith blue, toad green.
        const colour = def.bolt || [.55, .9, 1], key = colour.join(',');
        this.boltMaterials = this.boltMaterials || new Map();
        if (!this.boltMaterials.has(key)) {
            const material = new BABYLON.StandardMaterial('bolt-' + key, scene);
            material.emissiveColor = new BABYLON.Color3(...colour);
            material.diffuseColor = BABYLON.Color3.Black();
            material.specularColor = BABYLON.Color3.Black();
            material.disableLighting = true;
            this.boltMaterials.set(key, material);
        }
        const mesh = BABYLON.MeshBuilder.CreateIcoSphere('bolt', {radius: .22, subdivisions: 1}, scene);
        mesh.material = this.boltMaterials.get(key);
        mesh.isPickable = false;
        mesh.position.set(from.x, from.y + 1.25, from.z);
        const aim = Math.atan2(target.x - from.x, target.z - from.z) + spread;
        const dx = Math.sin(aim), dz = Math.cos(aim), length = 1;
        this.bolts.push({mesh, vx: dx / length * BOLT_SPEED, vz: dz / length * BOLT_SPEED, life: 2.4,
            damage: def.damage * (animal.damageScale || 1), cause: def.cause});
        this.game.audio?.play('bolt');
    }

    updateBolts(dt) {
        const player = this.game.playerSystem, target = player.camera.position, layout = this.layout();
        for (let i = this.bolts.length - 1; i >= 0; i--) {
            const bolt = this.bolts[i], position = bolt.mesh.position;
            position.x += bolt.vx * dt; position.z += bolt.vz * dt;
            bolt.life -= dt;
            let spent = bolt.life <= 0;
            if (layout) {
                const cell = cellOf(layout, position.x, position.z);
                if (!isOpen(layout, cell.x, cell.y)) spent = true;
            }
            if (!spent && !player.isDead && Math.hypot(target.x - position.x, target.z - position.z) < .75
                && Math.abs(target.y - .7 - position.y) < 1.6) {
                player.takeDamage(bolt.damage, bolt.cause);
                spent = true;
            }
            if (spent) {
                this.game.effects?.burst?.(position, 'ore', 6);
                bolt.mesh.dispose();
                this.bolts.splice(i, 1);
            }
        }
    }

    clearBolts() {
        for (const bolt of this.bolts) bolt.mesh.dispose();
        this.bolts.length = 0;
    }
}

