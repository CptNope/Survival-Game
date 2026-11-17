// Dungeons in the world: entrances on the surface, building a generated floor
// far below it, keeping the player inside its walls, and the chests, stairs
// and boss that make up a run. Layout rules live in ../dungeon.js.
import {
    CELL, GRID, FLOORS, dungeonsNear, dungeonEpoch, daysUntilReset, floorSeed, generateFloor,
    flowField, cellOf, centreOf, isOpen, lineOfSight, resolveCircle, themeFor, trapState, THEMES
} from '../dungeon.js';
import { createEntranceModel, createChestModel, createBrazierModel, createStairsModel, createTrapModel, createShrineModel } from '../models/creatures.js';
import { BOONS, SHRINE_BOONS } from './buffs.js';
import { seededRandom } from '../models/wilderness.js';

export const DUNGEON_DEPTH = -240; // World height of every dungeon floor.
export const CEILING = 4.4;
const PLAYER_RADIUS = .75;
const SUPPLIES = [{cookedMeat: 1}, {herbs: 2}, {berries: 3}, {iron: 1}, {cookedMeat: 2}, {fiber: 3, herbs: 1}];

export class DungeonSystem {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.site = null;
        this.floor = 0;
        this.layout = null;
        this.flow = null;
        this.floorY = DUNGEON_DEPTH;
        this.ceiling = CEILING;
        this.explored = new Uint8Array(GRID * GRID);
        this.entrances = new Map();
        this.found = new Set();
        this.runs = {}; // site id -> {epoch, opened: [chest keys], cleared, deepest}
        this.nearest = null;
        this.returnPosition = null;
        this.props = [];
        this.chests = [];
        this.braziers = [];
        this.markers = [];
        this.boss = null;
        this.mesh = null;
        this.ceilingMesh = null;
        this.capMesh = null;
        this.ceilingVisible = true;
        this.theme = THEMES[0];
        this.traps = [];
        this.shrine = null;
        this.time = 0;
        this.material = null;
        this.scanTimer = 0;
        this.lastCell = -1;
    }

    // --- Surface ------------------------------------------------------------
    runFor(site) {
        const epoch = dungeonEpoch(this.game.dayCount);
        const run = this.runs[site.id];
        if (!run || run.epoch !== epoch) this.runs[site.id] = {epoch, opened: [], cleared: false, deepest: 0};
        return this.runs[site.id];
    }

    isCleared(site) {
        const run = this.runs[site.id];
        return Boolean(run && run.cleared && run.epoch === dungeonEpoch(this.game.dayCount));
    }

    // Stream entrance models in and out around the player.
    scanEntrances() {
        const game = this.game, position = game.playerSystem.camera.position;
        const sites = dungeonsNear(position.x, position.z, 330);
        let nearest = null;
        const wanted = new Set();
        for (const site of sites) {
            const distance = Math.hypot(site.x - position.x, site.z - position.z);
            if (!nearest || distance < nearest.distance) nearest = {...site, distance, cleared: this.isCleared(site)};
            if (distance > 170) continue;
            wanted.add(site.id);
            if (!this.entrances.has(site.id)) {
                const seed = Math.abs(Math.floor(site.x * 31 + site.z * 17));
                const mesh = createEntranceModel(game.scene, seed);
                mesh.position.set(site.x, game.terrainSystem.getPerlinHeight(site.x, site.z) - .05, site.z);
                // Face the doorway back towards the clearing so the path leads in.
                mesh.rotation.y = Math.atan2(-site.x, -site.z);
                mesh.checkCollisions = true;
                mesh.isPickable = false;
                mesh.computeWorldMatrix(true);
                this.entrances.set(site.id, mesh);
            }
            if (distance < 34 && !this.found.has(site.id)) {
                this.found.add(site.id);
                game.uiSystem?.showNotification?.(`Found a way underground: ${site.name}`);
                game.audio?.play('discover');
                game.saveSystem?.save();
            }
        }
        for (const [id, mesh] of this.entrances) {
            if (wanted.has(id)) continue;
            mesh.dispose(false, true);
            this.entrances.delete(id);
        }
        this.nearest = nearest;
    }

    // The stretch of ground an entrance keeps clear of trees and rocks.
    static isEntranceGround(x, z) {
        return dungeonsNear(x, z, 9).length > 0;
    }

    // --- Entering and leaving -----------------------------------------------
    enter(site) {
        const game = this.game, player = game.playerSystem;
        if (this.active || player.isDead) return false;
        if (this.isCleared(site)) return false;
        this.site = site;
        this.theme = themeFor(site);
        this.runFor(site);
        const position = player.camera.position;
        this.returnPosition = {x: position.x, z: position.z};
        player.isFlying = false;
        game.buildSystem?.cancelPlacement?.();
        this.active = true;
        if (typeof document !== 'undefined') document.body?.classList.add('underground');
        this.buildFloor(1);
        game.progression?.record('delves');
        game.audio?.play('stairs');
        game.uiSystem?.showDayBanner?.(site.name, `Floor 1 of ${FLOORS} · Light your torch`, true, true);
        return true;
    }

    descend() {
        if (!this.active || this.floor >= FLOORS) return false;
        this.game.gear?.collectStragglers?.();
        this.buildFloor(this.floor + 1);
        this.game.audio?.play('stairs');
        this.game.uiSystem?.showDayBanner?.(this.site.name,
            this.floor >= FLOORS ? `Floor ${this.floor} of ${FLOORS} · Something heavy stirs below` : `Floor ${this.floor} of ${FLOORS}`, true, true);
        return true;
    }

    // Back to the surface, beside the entrance.
    leave(announce = true) {
        if (!this.active) return false;
        const game = this.game, player = game.playerSystem;
        game.gear?.collectStragglers?.();
        this.disposeFloor();
        this.active = false;
        this.layout = null;
        this.flow = null;
        this.boss = null;
        if (typeof document !== 'undefined') document.body?.classList.remove('underground');
        const back = this.returnPosition || {x: 0, z: 0};
        const camera = player.camera;
        camera.position.x = back.x; camera.position.z = back.z;
        camera.position.y = game.terrainSystem.getPerlinHeight(back.x, back.z) + 2;
        player.isGrounded = true; player.jumpVelocity = 0;
        game.terrainSystem.checkChunkUpdates?.();
        if (announce) {
            game.audio?.play('stairs');
            game.uiSystem?.showNotification?.(`Back on the surface · ${this.site.name}`);
            game.saveSystem?.save();
        }
        return true;
    }

    // Where supplies dropped on death should land: outside, by the entrance.
    deathDropPosition() {
        if (!this.active || !this.returnPosition) return null;
        const {x, z} = this.returnPosition;
        return {x, y: this.game.terrainSystem.getPerlinHeight(x, z), z};
    }

    // --- Building a floor ---------------------------------------------------
    disposeFloor() {
        this.game.animalSystem?.clearDungeon?.();
        for (const prop of this.props) prop.dispose(false, true);
        this.props = [];
        this.chests = [];
        this.braziers = [];
        this.markers = [];
        this.traps = [];
        this.shrine = null;
        for (const mesh of [this.mesh, this.ceilingMesh, this.capMesh]) mesh?.dispose(false, false);
        this.mesh = this.ceilingMesh = this.capMesh = null;
    }

    buildFloor(floor) {
        const game = this.game, site = this.site, run = this.runFor(site);
        this.disposeFloor();
        this.floor = floor;
        run.deepest = Math.max(run.deepest, floor);
        const layout = generateFloor(floorSeed(site.id, run.epoch, floor), floor, FLOORS);
        layout.originX = site.x - GRID * CELL / 2;
        layout.originZ = site.z - GRID * CELL / 2;
        this.layout = layout;
        this.explored = new Uint8Array(GRID * GRID);
        this.lastCell = -1;
        this.boss = null;
        this.mesh = this.buildMesh(layout);
        const y = this.floorY;

        const place = (mesh, cell, rotation = 0) => {
            const centre = centreOf(layout, cell.x, cell.y);
            mesh.position.set(centre.x, y, centre.z);
            mesh.rotation.y = rotation;
            mesh.isPickable = false;
            mesh.computeWorldMatrix(true);
            this.props.push(mesh);
            return centre;
        };
        // The way out is always where you came in; the way on is across the floor.
        this.markers.push({kind: 'up', ...place(createStairsModel(game.scene, 'up'), layout.start)});
        if (!layout.boss) this.markers.push({kind: 'down', ...place(createStairsModel(game.scene, 'down'), layout.exit)});

        layout.braziers.forEach((cell, n) => {
            const centre = place(createBrazierModel(game.scene), cell);
            this.braziers.push({id: `brazier:${floor}:${n}`, type: 'fire', x: centre.x, y: y + .8, z: centre.z});
        });
        layout.chests.forEach((cell, n) => {
            const key = `${floor}:${n}`, opened = run.opened.includes(key), boss = cell.tier === 'boss';
            // A mimic that has already been woken leaves no chest behind.
            if (cell.mimic && opened) return;
            const mesh = createChestModel(game.scene, boss, opened);
            const centre = place(mesh, cell, seededRandom(layout.seed + n)() * Math.PI * 2);
            this.chests.push({key, boss, opened, mesh, cell, mimic: Boolean(cell.mimic), x: centre.x, z: centre.z});
        });
        for (const cell of layout.traps) {
            const mesh = createTrapModel(game.scene);
            const centre = place(mesh, cell);
            this.traps.push({mesh, spikes: mesh.metadata.spikes, phase: cell.phase, x: centre.x, z: centre.z, struck: false, stage: 'rest'});
        }
        if (layout.shrine) {
            const mesh = createShrineModel(game.scene);
            const centre = place(mesh, layout.shrine);
            const used = run.opened.includes(`shrine:${floor}`);
            this.shrine = {mesh, used, x: centre.x, z: centre.z};
            if (used) mesh.metadata.rune.setEnabled(false);
        }

        const level = this.itemLevel();
        for (const spawn of layout.spawns) {
            if (spawn.kind === 'warden' && run.cleared) continue;
            const centre = centreOf(layout, spawn.x, spawn.y);
            const animal = game.animalSystem.spawnAnimal(centre.x, y, centre.z, spawn.kind,
                {dungeon: true, tier: site.tier, floor, level, elite: spawn.elite});
            if (spawn.kind === 'warden') this.boss = animal;
        }
        if (layout.boss && run.cleared) this.openWayOut(centreOf(layout, layout.exit.x, layout.exit.y));

        const start = centreOf(layout, layout.start.x, layout.start.y);
        const camera = game.playerSystem.camera;
        camera.position.x = start.x; camera.position.z = start.z; camera.position.y = y + 2;
        game.playerSystem.isGrounded = true;
        game.playerSystem.jumpVelocity = 0;
        this.reveal();
    }

    itemLevel() {
        return this.site.tier * 2 - 1 + (this.floor - 1);
    }

    // The floor is three meshes: floor and walls (only the wall faces that
    // border a walkable cell), the ceiling, and dark caps over the surrounding
    // rock. From overhead the ceiling is hidden and the caps shown instead.
    buildMesh(layout) {
        const y0 = this.floorY, y1 = this.floorY + CEILING, theme = this.theme;
        const random = seededRandom(layout.seed ^ 0x51ed);
        const sets = {main: this.vertexSet(), ceiling: this.vertexSet(), caps: this.vertexSet()};
        const quad = (set, corners, normal, tint, uv) => {
            const base = set.positions.length / 3, shade = .82 + random() * .26;
            corners.forEach((corner, n) => {
                set.positions.push(...corner);
                set.normals.push(...normal);
                set.colors.push(tint[0] * shade, tint[1] * shade, tint[2] * shade, 1);
                set.uvs.push(uv[n][0], uv[n][1]);
            });
            set.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };
        const tall = CEILING / CELL, flat = [[0, 0], [1, 0], [1, 1], [0, 1]], wall = [[0, 0], [1, 0], [1, tall], [0, tall]];
        for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
            const x0 = layout.originX + i * CELL, x1 = x0 + CELL, z0 = layout.originZ + j * CELL, z1 = z0 + CELL;
            const top = [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
            if (!isOpen(layout, i, j)) {
                // Rock beside a room or corridor gets a lid, so the map reads as solid from above.
                let edge = false;
                for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1; di++) if (isOpen(layout, i + di, j + dj)) { edge = true; break; }
                if (edge) quad(sets.caps, top, [0, 1, 0], [.05, .05, .06], flat);
                continue;
            }
            quad(sets.main, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, 1, 0], theme.floor, flat);
            quad(sets.ceiling, top, [0, -1, 0], theme.roof, flat);
            if (!isOpen(layout, i, j - 1)) quad(sets.main, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, 1], theme.wall, wall);
            if (!isOpen(layout, i, j + 1)) quad(sets.main, [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], [0, 0, -1], theme.wall, wall);
            if (!isOpen(layout, i - 1, j)) quad(sets.main, [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [1, 0, 0], theme.wall, wall);
            if (!isOpen(layout, i + 1, j)) quad(sets.main, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [-1, 0, 0], theme.wall, wall);
        }
        const build = (name, set, pickable) => {
            const mesh = new BABYLON.Mesh(name, this.game.scene);
            const data = new BABYLON.VertexData();
            Object.assign(data, set);
            data.applyToMesh(mesh);
            mesh.material = this.stoneMaterial();
            mesh.isPickable = pickable; // Blocks the reticle, so nothing is struck through a wall.
            mesh.checkCollisions = false; // Walls are enforced on the grid instead.
            mesh.receiveShadows = false;
            mesh.computeWorldMatrix(true);
            return mesh;
        };
        this.ceilingMesh = build('dungeon-ceiling', sets.ceiling, false);
        this.capMesh = build('dungeon-caps', sets.caps, false);
        this.setCeilingVisible(this.ceilingVisible);
        return build('dungeon-floor', sets.main, true);
    }

    vertexSet() { return {positions: [], normals: [], colors: [], uvs: [], indices: []}; }

    // Overhead view looks down through the roof.
    setCeilingVisible(visible) {
        this.ceilingVisible = visible !== false;
        this.ceilingMesh?.setEnabled(this.ceilingVisible);
        this.capMesh?.setEnabled(!this.ceilingVisible);
    }

    stoneMaterial() {
        if (this.material) return this.material;
        const scene = this.game.scene;
        const material = new BABYLON.StandardMaterial('dungeon-stone', scene);
        material.specularColor = BABYLON.Color3.Black();
        material.backFaceCulling = false;
        if (typeof document !== 'undefined') {
            // Masonry drawn once on a small canvas; colour comes from the vertices.
            const texture = new BABYLON.DynamicTexture('dungeon-bricks', {width: 128, height: 128}, scene, true);
            const ctx = texture.getContext(), random = seededRandom(90210);
            ctx.fillStyle = '#d9d9d6'; ctx.fillRect(0, 0, 128, 128);
            for (let n = 0; n < 420; n++) {
                ctx.fillStyle = ['#c2c2be', '#ecece8', '#b4b4b0', '#cfcfca'][Math.floor(random() * 4)];
                ctx.fillRect(Math.floor(random() * 128), Math.floor(random() * 128), 2 + Math.floor(random() * 3), 2);
            }
            ctx.fillStyle = '#77777a';
            for (let row = 0; row < 4; row++) {
                ctx.fillRect(0, row * 32, 128, 3);
                for (let column = 0; column < 2; column++) ctx.fillRect((column * 64 + (row % 2) * 32) % 128, row * 32, 3, 32);
            }
            texture.update();
            texture.wrapU = texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
            material.diffuseTexture = texture;
        }
        return this.material = material;
    }

    // --- Running a floor ----------------------------------------------------
    reveal() {
        const layout = this.layout, position = this.game.playerSystem.camera.position;
        const here = cellOf(layout, position.x, position.z);
        for (let j = here.y - 4; j <= here.y + 4; j++) for (let i = here.x - 4; i <= here.x + 4; i++) {
            if (!isOpen(layout, i, j) || this.explored[j * GRID + i]) continue;
            const centre = centreOf(layout, i, j);
            if (lineOfSight(layout, position.x, position.z, centre.x, centre.z)) this.explored[j * GRID + i] = 1;
        }
        this.flow = flowField(layout.grid, here.x, here.y);
    }

    update(dt) {
        const game = this.game;
        if (!this.active) {
            this.scanTimer -= dt;
            if (this.scanTimer <= 0) { this.scanTimer = .5; this.scanEntrances(); }
            return;
        }
        const camera = game.playerSystem.camera, layout = this.layout;
        this.time += dt;
        this.updateTraps();
        const fixed = resolveCircle(layout, camera.position.x, camera.position.z, PLAYER_RADIUS);
        camera.position.x = fixed.x; camera.position.z = fixed.z;
        const cell = cellOf(layout, fixed.x, fixed.z), id = cell.y * GRID + cell.x;
        if (id !== this.lastCell) { this.lastCell = id; this.reveal(); }
        if (this.boss && this.boss.health <= 0) this.boss = null;
    }

    // What E does here, and the prompt shown for it. Null when nothing is near.
    interaction() {
        const game = this.game, position = game.playerSystem.camera.position;
        const near = (x, z, range) => Math.hypot(x - position.x, z - position.z) < range;
        if (!this.active) {
            const site = this.nearest;
            if (!site || !near(site.x, site.z, 6.5)) return null;
            if (this.isCleared(site)) {
                const days = daysUntilReset(game.dayCount);
                return {label: `${site.name} lies quiet · It stirs again in ${days} day${days === 1 ? '' : 's'}`, act: null};
            }
            return {label: `Press E to descend into ${site.name}`, act: () => this.enter(site)};
        }
        for (const chest of this.chests) {
            if (chest.opened || !near(chest.x, chest.z, 2.9)) continue;
            if (chest.boss && this.boss) return {label: 'Sealed while the Stone Warden stands', act: null};
            return {label: chest.boss ? "Press E to open the Warden's hoard" : 'Press E to open the chest', act: () => this.openChest(chest)};
        }
        if (this.shrine && !this.shrine.used && near(this.shrine.x, this.shrine.z, 2.8))
            return {label: 'Press E to touch the shrine', act: () => this.useShrine()};
        for (const marker of this.markers) {
            if (!near(marker.x, marker.z, 2.6)) continue;
            if (marker.kind === 'down') return {label: `Press E to descend to floor ${this.floor + 1}`, act: () => this.descend()};
            return {label: 'Press E to climb back to the surface', act: () => this.leave()};
        }
        return null;
    }

    openChest(chest) {
        if (chest.opened) return false;
        const game = this.game, run = this.runFor(this.site);
        chest.opened = true;
        if (!run.opened.includes(chest.key)) run.opened.push(chest.key);
        const position = chest.mesh.position.clone(), rotation = chest.mesh.rotation.y;
        const index = this.props.indexOf(chest.mesh);
        if (chest.mimic) {
            // Not a chest at all. It keeps its loot until it is beaten.
            chest.mesh.dispose(false, true);
            if (index >= 0) this.props.splice(index, 1);
            this.chests.splice(this.chests.indexOf(chest), 1);
            const animal = game.animalSystem.spawnAnimal(position.x, this.floorY, position.z, 'mimic',
                {dungeon: true, tier: this.site.tier, floor: this.floor, level: this.itemLevel() + 1});
            animal.fleeTimer = 30; // Awake and angry.
            game.audio?.play('growl');
            game.effects?.hurt?.(1);
            game.uiSystem?.showNotification?.('The chest lunges at you: a mimic!');
            return true;
        }
        chest.mesh.dispose(false, true);
        chest.mesh = createChestModel(game.scene, chest.boss, true);
        chest.mesh.position.copyFrom(position); chest.mesh.rotation.y = rotation; chest.mesh.isPickable = false;
        if (index >= 0) this.props[index] = chest.mesh; else this.props.push(chest.mesh);

        // Gear spills out around the chest; supplies go straight into the pack.
        const pieces = chest.boss ? 2 : 1 + (Math.random() < .3 ? 1 : 0);
        for (let n = 0; n < pieces; n++) {
            const angle = rotation + Math.PI + (n - (pieces - 1) / 2) * .9;
            const spot = resolveCircle(this.layout, chest.x + Math.sin(angle) * 1.5, chest.z + Math.cos(angle) * 1.5, .4);
            game.gear?.dropRoll?.(new BABYLON.Vector3(spot.x, this.floorY, spot.z), {
                level: this.itemLevel() + (chest.boss ? 1 : 0),
                luck: .12 + this.floor * .14 + (chest.boss ? .6 : 0),
                minRarity: chest.boss ? 'rare' : 'common'
            });
        }
        const supplies = SUPPLIES[Math.floor(Math.random() * SUPPLIES.length)];
        const inventory = game.inventorySystem.inventory;
        for (const [item, amount] of Object.entries(supplies)) inventory[item] += amount * (chest.boss ? 2 : 1);
        game.uiSystem?.updateInventoryUI?.();
        game.audio?.play('chest');
        game.effects?.burst?.(position.add(new BABYLON.Vector3(0, .8, 0)), 'ore', 14);
        game.progression?.record('chests');
        return true;
    }

    onBossAwake() {
        this.game.uiSystem?.showNotification?.('The Stone Warden wakes');
    }

    onBossDefeated(animal, position) {
        const game = this.game;
        this.boss = null;
        this.runFor(this.site).cleared = true;
        this.openWayOut(position);
        game.audio?.play('levelup');
        game.uiSystem?.showDayBanner?.('Warden defeated', "Its hoard is unsealed · A way out has opened", false, true);
        game.saveSystem?.save();
    }

    // A second exit beside the fallen boss, so there is no long walk back.
    openWayOut(position) {
        if (this.markers.some(marker => marker.kind === 'up' && marker.shortcut)) return;
        const spot = resolveCircle(this.layout, position.x + 2.5, position.z + 2.5, 1.2);
        const mesh = createStairsModel(this.game.scene, 'up');
        mesh.position.set(spot.x, this.floorY, spot.z);
        this.props.push(mesh);
        this.markers.push({kind: 'up', shortcut: true, x: spot.x, z: spot.z});
    }

    // Spawn `count` creatures in open cells around a creature or a point.
    summonAround(origin, kind, count, radius = 3.4) {
        const layout = this.layout, centre = origin.mesh ? origin.mesh.position : origin;
        if (!layout) return 0;
        let made = 0;
        for (let n = 0; n < 12 && made < count; n++) {
            const angle = n * 2.4, x = centre.x + Math.sin(angle) * radius, z = centre.z + Math.cos(angle) * radius;
            const cell = cellOf(layout, x, z);
            if (!isOpen(layout, cell.x, cell.y)) continue;
            const spot = resolveCircle(layout, x, z, .5);
            const animal = this.game.animalSystem.spawnAnimal(spot.x, this.floorY, spot.z, kind,
                {dungeon: true, tier: this.site.tier, floor: this.floor, level: this.itemLevel()});
            animal.fleeTimer = 12; // Newcomers know where the fight is.
            made++;
        }
        return made;
    }

    // Spike traps run on a fixed cycle: rest, glow a warning, strike, retract.
    // Standing on one as it strikes hurts; jumping over or waiting does not.
    updateTraps() {
        if (!this.traps.length) return;
        const game = this.game, player = game.playerSystem, position = player.camera.position;
        for (const trap of this.traps) {
            const state = trapState(this.time, trap.phase);
            trap.spikes.position.y = -1.1 + state.raised * 1.1;
            if (state.stage !== trap.stage) {
                if (state.stage === 'warn') trap.mesh.material.emissiveColor = new BABYLON.Color3(.5, .08, .04);
                else if (state.stage === 'up') {
                    trap.struck = false;
                    if (Math.hypot(trap.x - position.x, trap.z - position.z) < 14) game.audio?.play('trap');
                } else trap.mesh.material.emissiveColor = BABYLON.Color3.Black();
                trap.stage = state.stage;
            }
            if (state.stage !== 'up' || trap.struck || player.isDead) continue;
            const onPlate = Math.abs(trap.x - position.x) < 1.15 && Math.abs(trap.z - position.z) < 1.15;
            const feetDown = position.y - this.floorY < 2.7; // A jump clears the points.
            if (onPlate && feetDown) {
                trap.struck = true;
                player.takeDamage(9 * (1 + (this.site.tier - 1) * .25 + (this.floor - 1) * .15), 'a spike trap');
            }
        }
    }

    // A shrine gives one boon per visit to the floor: either full health or a
    // timed blessing.
    useShrine() {
        const shrine = this.shrine, game = this.game;
        if (!shrine || shrine.used) return false;
        shrine.used = true;
        shrine.mesh.metadata.rune.setEnabled(false);
        const run = this.runFor(this.site), key = `shrine:${this.floor}`;
        if (!run.opened.includes(key)) run.opened.push(key);
        const player = game.playerSystem;
        // Healing is only on offer to someone who needs it, and likelier the worse off they are.
        const hurt = player.health < player.maxHealth * .7 ? 2 : player.health < player.maxHealth ? 1 : 0;
        const options = [...SHRINE_BOONS, ...Array(hurt).fill('vigor')];
        const boon = options[Math.floor(Math.random() * options.length)];
        if (boon === 'vigor') {
            player.health = player.maxHealth;
            game.uiSystem?.showNotification?.('The shrine restores you · Health full');
        } else {
            game.buffs?.add(boon);
            game.uiSystem?.showNotification?.(`The shrine grants ${BOONS[boon].label} · ${BOONS[boon].text} for ${Math.round(BOONS[boon].seconds / 60)} minutes`);
        }
        game.audio?.play('shrine');
        game.effects?.burst?.(shrine.mesh.position.add(new BABYLON.Vector3(0, 1.5, 0)), 'leaf', 18);
        game.progression?.record('shrines');
        return true;
    }

    // --- Saving -------------------------------------------------------------
    capture() {
        const epoch = dungeonEpoch(this.game.dayCount);
        const runs = {};
        for (const [id, run] of Object.entries(this.runs)) {
            if (run.epoch === epoch) runs[id] = {epoch, opened: run.opened.slice(0, 60), cleared: run.cleared, deepest: run.deepest};
        }
        return {found: [...this.found].slice(-500), runs};
    }

    restore(saved) {
        this.found = new Set((Array.isArray(saved?.found) ? saved.found : []).filter(id => typeof id === 'string').slice(-500));
        this.runs = {};
        const runs = saved?.runs && typeof saved.runs === 'object' ? saved.runs : {};
        for (const [id, run] of Object.entries(runs).slice(0, 200)) {
            if (!run || typeof run !== 'object' || !Number.isFinite(run.epoch)) continue;
            this.runs[id] = {
                epoch: Math.floor(run.epoch),
                opened: (Array.isArray(run.opened) ? run.opened : []).filter(key => typeof key === 'string').slice(0, 60),
                cleared: run.cleared === true,
                deepest: Math.max(0, Math.min(FLOORS, Math.floor(run.deepest) || 0))
            };
        }
    }
}
