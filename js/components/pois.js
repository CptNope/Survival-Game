// Points of interest in the world: puts the models down as you come near,
// notices when you reach one, and does what each kind does. The rules it
// follows are in js/pois.js.
import {
    POI_KINDS, DENS, HAVENS, DISCOVER_RADIUS, USE_RADIUS, DEN_WAKE_RADIUS, DEN_REFILL_DAYS,
    poisNear, poiById, surveyTargets, denPack, denReady, denOutcome, havenReady, travelChoices
} from '../pois.js';
import { createPoiModel, setRune } from '../models/pois.js';
import { landmarksNear } from './exploration.js';
import { dungeonsNear, STARTER_DUNGEON } from '../dungeon.js';
import { CREATURES } from '../creatures.js';
import { ITEMS } from '../resources.js';
import { WATERSKIN_CAPACITY } from './survival.js';
import { seededRandom } from '../models/wilderness.js';

const SHOW = 240, HIDE = 285;   // Models appear inside the first and go beyond the second.
const SOLID = poi => poi.kind === 'tower' || poi.kind === 'waystone' || (poi.kind === 'haven' && poi.region === 'marsh');
const haul = items => Object.entries(items).map(([item, amount]) => `+${amount} ${ITEMS[item].toLowerCase()}`).join(' · ');
const plural = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;
const idList = (value, limit) => (Array.isArray(value) ? value : [])
    .filter(id => typeof id === 'string' && id.length <= 40).slice(-limit);
const dayMap = value => new Map(Object.entries(value && typeof value === 'object' ? value : {})
    .filter(([id, day]) => poiById(id) && Number.isFinite(day)).map(([id, day]) => [id, Math.max(1, Math.floor(day))]));

export class PoiSystem {
    constructor(game) {
        this.game = game;
        this.found = new Set();      // Places you have walked up to.
        this.sighted = new Set();    // Anything a watchtower has shown you: places, landmarks, ways underground.
        this.attuned = new Set();    // Waystones you can travel between.
        this.cleared = new Map();    // Den id -> the day it was cleared.
        this.used = new Map();       // Haven id -> the day it last gave.
        this.meshes = new Map();
        this.fights = new Map();     // Den id -> its defenders.
        this.timer = 0;
    }

    // Keep trees and rocks off a place's doorstep.
    isClearing(x, z) {
        return poisNear(x, z, 11).length > 0;
    }

    place(poi) {
        const game = this.game, mesh = createPoiModel(game.scene, poi);
        mesh.position.set(poi.x, game.terrainSystem.getPerlinHeight(poi.x, poi.z) - .08, poi.z);
        mesh.rotation.y = seededRandom(Math.floor(poi.x * 13 + poi.z * 7) | 0)() * Math.PI * 2;
        mesh.checkCollisions = SOLID(poi);
        mesh.computeWorldMatrix(true);
        game.registerModelShadow?.(mesh);
        if (poi.kind === 'waystone') setRune(mesh, this.attuned.has(poi.id));
        this.meshes.set(poi.id, mesh);
        return mesh;
    }

    update(dt) {
        const game = this.game;
        if (game.paused) return;
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = .35;
        const player = game.playerSystem, position = player.camera.position;
        if (game.dungeonSystem?.active) return; // The surface waits while you are below.
        for (const poi of poisNear(position.x, position.z, SHOW)) {
            const distance = Math.hypot(poi.x - position.x, poi.z - position.z);
            if (!this.meshes.has(poi.id)) this.place(poi);
            if (distance < DISCOVER_RADIUS && !this.found.has(poi.id) && !player.isDead) this.discover(poi);
            if (poi.kind === 'den') this.tendDen(poi, distance);
        }
        for (const [id, mesh] of this.meshes) {
            const poi = poiById(id);
            if (poi && Math.hypot(poi.x - position.x, poi.z - position.z) <= HIDE) continue;
            mesh.dispose(false, true);
            this.meshes.delete(id);
        }
    }

    discover(poi) {
        if (this.found.has(poi.id)) return false;
        const game = this.game;
        this.found.add(poi.id);
        const hint = poi.kind === 'tower' ? 'Climb it to see what lies around'
            : poi.kind === 'waystone' ? 'Wake it to travel between waystones'
            : poi.kind === 'den' ? 'Something lives here'
            : `A place to ${HAVENS[poi.region].verb}`;
        game.uiSystem?.showNotification?.(`Found ${poi.name} · ${hint}`);
        game.audio?.play('discover');
        game.combatSystem?.gainExperience?.(12);
        game.progression?.record?.('places');
        game.saveSystem?.save?.();
        return true;
    }

    // The place within reach, if there is one.
    here(reach = USE_RADIUS) {
        const game = this.game;
        if (game.dungeonSystem?.active) return null;
        const position = game.playerSystem.camera.position;
        let best = null, closest = reach;
        for (const poi of poisNear(position.x, position.z, reach)) {
            const distance = Math.hypot(poi.x - position.x, poi.z - position.z);
            if (distance <= closest) { best = poi; closest = distance; }
        }
        return best;
    }

    // What E does here, as {label, act}. A label with no act is only a hint.
    interaction() {
        const poi = this.here(), game = this.game;
        if (!poi || game.playerSystem.isDead) return null;
        if (poi.kind === 'tower') return {label: 'Press E to climb the watchtower and look around', act: () => this.survey(poi)};
        if (poi.kind === 'waystone') {
            if (!this.attuned.has(poi.id)) return {label: 'Press E to wake the waystone', act: () => this.attune(poi)};
            return travelChoices(this.attuned, poi).length
                ? {label: 'Press E to travel from the waystone', act: () => { game.uiSystem?.openPanel?.('map'); return true; }}
                : {label: `${poi.name} · wake another waystone to travel between them`};
        }
        if (poi.kind === 'haven') {
            const haven = HAVENS[poi.region];
            return havenReady(this.used.get(poi.id), game.dayCount)
                ? {label: `Press E to ${haven.verb}`, act: () => this.useHaven(poi)}
                : {label: `${poi.name} · come back tomorrow`};
        }
        return null;
    }

    // From the top of a tower: everything nearby goes on the map.
    survey(poi) {
        const game = this.game, seen = {site: 0, dungeon: 0, poi: 0};
        for (const target of surveyTargets(poi.x, poi.z)) {
            if (target.id === poi.id || this.known(target) || this.sighted.has(target.id)) continue;
            this.sighted.add(target.id);
            seen[target.type]++;
        }
        const parts = [seen.site && plural(seen.site, 'landmark'), seen.dungeon && plural(seen.dungeon, 'way underground', 'ways underground'),
            seen.poi && plural(seen.poi, 'point of interest', 'points of interest')].filter(Boolean);
        game.audio?.play(parts.length ? 'discover' : 'click');
        if (parts.length) game.uiSystem?.showDayBanner?.(poi.name, `From the top: ${parts.join(', ')} · marked on your map`, false, true);
        else game.uiSystem?.showNotification?.('Nothing new to see from up here');
        game.saveSystem?.save?.();
        return true;
    }

    // Have you already been there?
    known(target) {
        const game = this.game;
        return target.type === 'site' ? Boolean(game.explorationSystem?.discovered.has(target.id))
            : target.type === 'dungeon' ? Boolean(game.dungeonSystem?.runs?.[target.id]) || target.id === STARTER_DUNGEON.id
            : this.found.has(target.id);
    }

    attune(poi) {
        if (poi.kind !== 'waystone' || this.attuned.has(poi.id)) return false;
        const game = this.game;
        this.attuned.add(poi.id);
        setRune(this.meshes.get(poi.id), true);
        game.audio?.play('shrine');
        game.uiSystem?.showNotification?.(this.attuned.size > 1
            ? `${poi.name} wakes · Press E here to travel between waystones`
            : `${poi.name} wakes · Wake another and you can travel between them`);
        game.saveSystem?.save?.();
        return true;
    }

    // Where you could step to from where you stand, nearest first.
    travelOptions() {
        const poi = this.here(USE_RADIUS + 2);
        return poi?.kind === 'waystone' && this.attuned.has(poi.id) ? travelChoices(this.attuned, poi) : [];
    }

    travel(id) {
        const game = this.game, player = game.playerSystem;
        const target = this.travelOptions().find(option => option.id === id);
        if (!target || player.isDead) return false;
        if (game.legends?.active) {
            game.uiSystem?.showNotification?.('The waystone will not answer while a legend hunts you');
            game.audio?.play('deny');
            return false;
        }
        // Arrive a pace in front of the stone, facing it.
        const camera = player.camera, x = target.x, z = target.z + 4.4;
        camera.position.x = x; camera.position.z = z;
        camera.position.y = game.terrainSystem.getPerlinHeight(x, z) + 2;
        camera.cameraDirection?.setAll?.(0);
        camera.rotation.y = Math.PI;
        player.isGrounded = true; player.jumpVelocity = 0; player.isFlying = false;
        game.terrainSystem.checkChunkUpdates?.();
        game.companion?.toHeel?.();
        this.timer = 0;
        game.uiSystem?.closePanel?.();
        game.audio?.play('stairs');
        game.uiSystem?.showNotification?.(`You step out at ${target.name}`);
        game.saveSystem?.save?.();
        return true;
    }

    useHaven(poi) {
        const game = this.game, haven = HAVENS[poi.region], today = game.dayCount;
        if (poi.kind !== 'haven' || !haven || !havenReady(this.used.get(poi.id), today)) return false;
        const effect = haven.effect, player = game.playerSystem, survival = game.survivalSystem, got = [];
        if (effect.hunger) survival.hunger = Math.min(100, survival.hunger + effect.hunger);
        if (Number.isFinite(effect.thirst)) survival.thirst = Math.max(survival.thirst, effect.thirst);
        if (Number.isFinite(effect.cold)) survival.cold = Math.min(survival.cold, effect.cold);
        if (effect.water && survival.hasWaterskin?.()) { survival.water = WATERSKIN_CAPACITY; got.push('waterskin filled'); }
        if (effect.heal) player.health = Math.min(player.maxHealth, player.health + effect.heal);
        if (effect.cure) player.poisonLeft = 0;
        if (effect.buff && game.buffs?.add(effect.buff)) got.push(`${effect.buff === 'warmth' ? 'warmed' : 'immune to venom'} for a while`);
        if (effect.items) {
            for (const [item, amount] of Object.entries(effect.items)) game.inventorySystem.inventory[item] += amount;
            got.push(haul(effect.items));
        }
        this.used.set(poi.id, today);
        game.audio?.play(poi.region === 'desert' ? 'drink' : 'heal');
        game.uiSystem?.updateInventoryUI?.();
        game.uiSystem?.showNotification?.([haven.done, ...got].join(' · '));
        game.saveSystem?.save?.();
        return true;
    }

    // --- Dens ---------------------------------------------------------------
    tendDen(poi, distance) {
        const game = this.game, fight = this.fights.get(poi.id);
        if (!fight) {
            if (distance < DEN_WAKE_RADIUS && !game.playerSystem.isDead && denReady(this.cleared.get(poi.id), game.dayCount)) this.wakeDen(poi);
            return;
        }
        const animals = game.animalSystem.animals;
        const outcome = denOutcome(fight.map(animal => ({health: animal.health, present: animals.includes(animal)})));
        if (outcome === 'cleared') this.clearDen(poi);
        // Left behind: whoever is still alive has gone back inside.
        else if (outcome !== 'fighting') this.fights.delete(poi.id);
    }

    wakeDen(poi) {
        const game = this.game, den = DENS[poi.region] || DENS.meadow, pack = denPack(poi), defenders = [];
        this.discover(poi); // You know it is there once its owners are coming at you.
        pack.forEach((one, n) => {
            const angle = n / pack.length * Math.PI * 2 + poi.x, x = poi.x + Math.sin(angle) * 4.2, z = poi.z + Math.cos(angle) * 4.2;
            const animal = game.animalSystem.spawnAnimal(x, game.terrainSystem.getPerlinHeight(x, z), z, one.kind,
                {level: poi.level, tier: 1 + (poi.level - 1) * .5, elite: one.elite});
            animal.den = poi.id;
            defenders.push(animal);
        });
        this.fights.set(poi.id, defenders);
        game.audio?.play(CREATURES[den.kind]?.sound || 'growl');
        game.uiSystem?.showNotification?.(`${poi.name} · ${plural(defenders.length, CREATURES[den.kind]?.label.toLowerCase() || den.kind)} come out to meet you`);
        return defenders;
    }

    clearDen(poi) {
        const game = this.game, den = DENS[poi.region] || DENS.meadow;
        this.fights.delete(poi.id);
        this.cleared.set(poi.id, game.dayCount);
        const x = poi.x + 1.2, z = poi.z + 1.2;
        game.gear?.dropRoll?.(new BABYLON.Vector3(x, game.terrainSystem.getPerlinHeight(x, z), z), {level: poi.level, luck: .3});
        for (const [item, amount] of Object.entries(den.spoils)) game.inventorySystem.inventory[item] += amount;
        game.combatSystem?.gainExperience?.(20 + 10 * poi.level);
        game.progression?.record?.('dens');
        game.audio?.play('levelup');
        game.uiSystem?.updateInventoryUI?.();
        game.uiSystem?.showDayBanner?.(`${poi.name} cleared`, `${haul(den.spoils)} · something will move back in within ${DEN_REFILL_DAYS} days`, false, true);
        game.saveSystem?.save?.();
        return true;
    }

    // --- Map ----------------------------------------------------------------
    // What to draw: places you have reached, and (marked `seen`) anything you
    // have only made out from the top of a tower.
    mapMarks(position, reach) {
        const game = this.game, marks = [];
        for (const site of landmarksNear(position.x, position.z, reach))
            if (this.sighted.has(site.id) && !game.explorationSystem?.discovered.has(site.id)) marks.push({kind: 'site', seen: true, label: site.name, x: site.x, z: site.z});
        for (const site of dungeonsNear(position.x, position.z, reach))
            if (this.sighted.has(site.id) && !this.known({type: 'dungeon', id: site.id})) marks.push({kind: 'dungeon', seen: true, label: site.name, x: site.x, z: site.z});
        for (const poi of poisNear(position.x, position.z, reach)) {
            if (this.found.has(poi.id)) {
                const kind = poi.kind === 'den' && !denReady(this.cleared.get(poi.id), game.dayCount) ? 'denCleared' : poi.kind;
                marks.push({kind, label: poi.name, x: poi.x, z: poi.z});
            } else if (this.sighted.has(poi.id)) marks.push({kind: poi.kind, seen: true, label: poi.name, x: poi.x, z: poi.z});
        }
        return marks;
    }

    // --- Saves --------------------------------------------------------------
    capture() {
        return {
            found: [...this.found].slice(-4000), sighted: [...this.sighted].slice(-6000), attuned: [...this.attuned].slice(-400),
            cleared: Object.fromEntries([...this.cleared].slice(-2000)), used: Object.fromEntries([...this.used].slice(-2000))
        };
    }

    restore(saved) {
        const isWaystone = id => poiById(id)?.kind === 'waystone';
        this.found = new Set(idList(saved?.found, 4000).filter(id => poiById(id)));
        this.sighted = new Set(idList(saved?.sighted, 6000));
        this.attuned = new Set(idList(saved?.attuned, 400).filter(isWaystone));
        this.cleared = dayMap(saved?.cleared);
        this.used = dayMap(saved?.used);
        this.fights.clear();
        for (const [id, mesh] of this.meshes) if (isWaystone(id)) setRune(mesh, this.attuned.has(id));
    }
}

export { POI_KINDS };
