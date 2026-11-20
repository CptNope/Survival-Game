// Points of interest in the world: puts the models down as you come near,
// notices when you reach one, and does what each kind does. The rules it
// follows are in js/pois.js.
import {
    POI_KINDS, DENS, HAVENS, SHRINES, SHRINE_SECONDS, DISCOVER_RADIUS, USE_RADIUS, DEN_WAKE_RADIUS, DEN_REFILL_DAYS,
    poisNear, poiById, surveyTargets, denPack, denReady, denOutcome, havenReady, travelChoices, cacheFor, tradeOffers, canAfford
} from '../pois.js';
import { createPoiModel, createCacheModel, setRune } from '../models/pois.js';
import { rollGear } from '../gear.js';
import { BOONS } from './buffs.js';
import { landmarksNear } from './exploration.js';
import { dungeonsNear, STARTER_DUNGEON } from '../dungeon.js';
import { CREATURES } from '../creatures.js';
import { ITEMS } from '../resources.js';
import { WATERSKIN_CAPACITY } from './survival.js';
import { seededRandom } from '../models/wilderness.js';

const SHOW = 240, HIDE = 285;   // Models appear inside the first and go beyond the second.
const WRECK_SPOILS = {iron: 2, arrows: 8}, CACHE_SPOILS = {iron: 1, arrows: 6, herbs: 2};
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const heading = bearing => COMPASS[(Math.round(bearing / (Math.PI / 4)) % 8 + 8) % 8];
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
        this.leads = new Set();      // Cairns whose note you have read.
        this.dug = new Set();        // Cairns whose cache you have dug up.
        this.looted = new Set();     // Wrecks whose chest you have opened.
        this.trades = new Map();     // Trader id -> {day, sold: [how many of each line]}.
        this.mounds = new Map();     // Cairn id -> the mound over its cache.
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
            // A wreck is found from the surface above it, so from a little further off.
            if (distance < (poi.kind === 'wreck' ? DISCOVER_RADIUS + 8 : DISCOVER_RADIUS) && !this.found.has(poi.id) && !player.isDead) this.discover(poi);
            if (poi.kind === 'den') this.tendDen(poi, distance);
        }
        this.tendMounds(position);
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
            : poi.kind === 'trader' ? 'Bring what you can spare'
            : poi.kind === 'shrine' ? 'Pray for what its beast can lend'
            : poi.kind === 'cairn' ? 'Someone left a note under it'
            : poi.kind === 'wreck' ? 'Dive to the chest on her deck'
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
        const game = this.game;
        if (game.playerSystem.isDead || game.dungeonSystem?.active) return null;
        const dig = this.digSpot();
        if (dig) return {label: 'Press E to dig up the cache', act: () => this.dig(dig)};
        const poi = this.here(USE_RADIUS + 2);
        if (!poi) return null;
        if (poi.kind === 'wreck') return this.wreckAction(poi);
        if (Math.hypot(poi.x - game.playerSystem.camera.position.x, poi.z - game.playerSystem.camera.position.z) > USE_RADIUS) return null;
        if (poi.kind === 'trader') return {label: `Press E to trade with ${poi.keeper}`, act: () => { game.uiSystem?.openTrade?.(poi.id); return true; }};
        if (poi.kind === 'shrine') {
            return havenReady(this.used.get(poi.id), game.dayCount)
                ? {label: 'Press E to pray at the shrine', act: () => this.pray(poi)}
                : {label: `${poi.name} · it has given today`};
        }
        if (poi.kind === 'cairn') {
            if (!this.leads.has(poi.id)) return {label: 'Press E to read the note under the cairn', act: () => this.readCairn(poi)};
            const cache = cacheFor(poi);
            return this.dug.has(poi.id) || !cache ? null
                : {label: `The note says: ${Math.round(cache.distance / 10) * 10} paces ${heading(cache.bearing)}`};
        }
        if (poi.kind === 'tower') {
            // A watchtower has a notice board at its foot: look around, then read it.
            const notice = game.bounties?.actionable(poi);
            return {label: 'Press E to climb the watchtower and look around' + (notice ? ' · there is a notice on the post' : ''),
                act: () => { this.survey(poi); if (game.bounties?.actionable(poi)) game.uiSystem?.openTrade?.(poi.id); return true; }};
        }
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

    // --- Shrines ------------------------------------------------------------
    pray(poi) {
        const game = this.game;
        if (poi.kind !== 'shrine' || !SHRINES[poi.boon] || !havenReady(this.used.get(poi.id), game.dayCount)) return false;
        game.buffs?.add(poi.boon, SHRINE_SECONDS);
        this.used.set(poi.id, game.dayCount);
        game.audio?.play('shrine');
        game.progression?.record?.('shrines');
        game.uiSystem?.showNotification?.(`${BOONS[poi.boon].label} · ${SHRINES[poi.boon].gift} for ${SHRINE_SECONDS / 60} minutes`);
        game.saveSystem?.save?.();
        return true;
    }

    // --- Cairns and caches --------------------------------------------------
    readCairn(poi) {
        const game = this.game, cache = cacheFor(poi);
        if (poi.kind !== 'cairn' || this.leads.has(poi.id)) return false;
        this.leads.add(poi.id);
        game.audio?.play('discover');
        if (cache) game.uiSystem?.showDayBanner?.('A note under the stones', `"${Math.round(cache.distance / 10) * 10} paces ${heading(cache.bearing)}, under two crossed sticks" · marked on your map`, false, true);
        else game.uiSystem?.showNotification?.('The note has rotted away');
        this.timer = 0;
        game.saveSystem?.save?.();
        return true;
    }

    // Caches you know of and have not dug: [{poi, cache}].
    openLeads() {
        const out = [];
        for (const id of this.leads) {
            if (this.dug.has(id)) continue;
            const poi = poiById(id), cache = poi && cacheFor(poi);
            if (cache) out.push({poi, cache});
        }
        return out;
    }

    // The cache underfoot, if you are standing on one you know about.
    digSpot() {
        const position = this.game.playerSystem.camera.position;
        return this.openLeads().find(({cache}) => Math.hypot(cache.x - position.x, cache.z - position.z) <= USE_RADIUS) || null;
    }

    dig({poi, cache}) {
        const game = this.game;
        if (this.dug.has(poi.id) || !this.leads.has(poi.id)) return false;
        this.dug.add(poi.id);
        this.mounds.get(poi.id)?.dispose(false, true);
        this.mounds.delete(poi.id);
        game.gear?.dropRoll?.(new BABYLON.Vector3(cache.x + .8, game.terrainSystem.getPerlinHeight(cache.x + .8, cache.z + .8), cache.z + .8), {level: poi.level + 1, luck: .35});
        for (const [item, amount] of Object.entries(CACHE_SPOILS)) game.inventorySystem.inventory[item] += amount;
        game.combatSystem?.gainExperience?.(25);
        game.progression?.record?.('caches');
        game.audio?.play('collect');
        game.uiSystem?.updateInventoryUI?.();
        game.uiSystem?.showNotification?.(`Dug up a cache · ${haul(CACHE_SPOILS)}`);
        game.saveSystem?.save?.();
        return true;
    }

    // A mound shows where each known cache lies, once you are near enough to see it.
    tendMounds(position) {
        const game = this.game, wanted = new Set();
        for (const {poi, cache} of this.openLeads()) {
            if (Math.hypot(cache.x - position.x, cache.z - position.z) > 120) continue;
            wanted.add(poi.id);
            if (this.mounds.has(poi.id)) continue;
            const mesh = createCacheModel(game.scene, Math.floor(cache.x * 3 + cache.z));
            mesh.position.set(cache.x, game.terrainSystem.getPerlinHeight(cache.x, cache.z), cache.z);
            mesh.computeWorldMatrix(true);
            this.mounds.set(poi.id, mesh);
        }
        for (const [id, mesh] of this.mounds) {
            if (wanted.has(id)) continue;
            mesh.dispose(false, true);
            this.mounds.delete(id);
        }
    }

    // --- Wrecks -------------------------------------------------------------
    // The chest is on the lake bed: you have to be under the water to open it.
    wreckAction(poi) {
        if (this.looted.has(poi.id)) return null;
        const player = this.game.playerSystem;
        return player.isUnderwater
            ? {label: 'Press E to prise open the chest', act: () => this.loot(poi)}
            : {label: `${poi.name} lies below · dive to reach her chest`};
    }

    loot(poi) {
        const game = this.game;
        if (poi.kind !== 'wreck' || this.looted.has(poi.id)) return false;
        this.looted.add(poi.id);
        // Straight into the bag: a drop on the lake bed would be a swim to pick up.
        game.gear?.add?.(rollGear(Math.random, {level: poi.level + 1, luck: .45 + (game.perks?.value?.('luck') || 0), minRarity: 'uncommon'}));
        for (const [item, amount] of Object.entries(WRECK_SPOILS)) game.inventorySystem.inventory[item] += amount;
        game.combatSystem?.gainExperience?.(30);
        game.progression?.record?.('wrecks');
        game.audio?.play('collect');
        game.uiSystem?.updateInventoryUI?.();
        game.uiSystem?.showNotification?.(`${poi.name} gives up her chest · ${haul(WRECK_SPOILS)}`);
        game.saveSystem?.save?.();
        return true;
    }

    // --- Traders ------------------------------------------------------------
    // Today's lines at a trader, each with how many are left and whether you can pay.
    offers(poi) {
        const game = this.game, today = game.dayCount, record = this.trades.get(poi.id);
        const sold = record?.day === today ? record.sold : [];
        return tradeOffers(poi, today).map((offer, index) => {
            const left = Math.max(0, offer.stock - (sold[index] || 0));
            return {...offer, index, left, affordable: left > 0 && canAfford(game.inventorySystem.inventory, offer)};
        });
    }

    trade(id, index) {
        const game = this.game, poi = this.here(USE_RADIUS + 2);
        if (!poi || poi.kind !== 'trader' || poi.id !== id) return false;
        const offer = this.offers(poi)[index], inventory = game.inventorySystem.inventory;
        if (!offer || !offer.affordable) { game.audio?.play('deny'); return false; }
        for (const [item, amount] of Object.entries(offer.give)) inventory[item] -= amount;
        if (offer.gear) game.gear?.add?.(rollGear(Math.random, {level: poi.level, luck: .3 + (game.perks?.value?.('luck') || 0)}));
        else for (const [item, amount] of Object.entries(offer.get)) inventory[item] += amount;
        const today = game.dayCount, record = this.trades.get(poi.id);
        const sold = record?.day === today ? record.sold : tradeOffers(poi, today).map(() => 0);
        sold[index] = (sold[index] || 0) + 1;
        this.trades.set(poi.id, {day: today, sold});
        game.progression?.record?.('trades');
        game.audio?.play('equip');
        game.effects?.refreshHeld?.();
        game.uiSystem?.updateInventoryUI?.();
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
        for (const {cache} of this.openLeads())
            if (Math.hypot(cache.x - position.x, cache.z - position.z) <= reach) marks.push({kind: 'cache', label: 'A buried cache', x: cache.x, z: cache.z});
        return marks;
    }

    // --- Saves --------------------------------------------------------------
    capture() {
        return {
            found: [...this.found].slice(-4000), sighted: [...this.sighted].slice(-6000), attuned: [...this.attuned].slice(-400),
            cleared: Object.fromEntries([...this.cleared].slice(-2000)), used: Object.fromEntries([...this.used].slice(-2000)),
            leads: [...this.leads].slice(-1000), dug: [...this.dug].slice(-1000), looted: [...this.looted].slice(-500),
            // Only today's dealings matter: yesterday's stock is back on the board.
            trades: Object.fromEntries([...this.trades].filter(([, record]) => record.day === this.game.dayCount).slice(-200))
        };
    }

    restore(saved) {
        const isWaystone = id => poiById(id)?.kind === 'waystone';
        this.found = new Set(idList(saved?.found, 4000).filter(id => poiById(id)));
        this.sighted = new Set(idList(saved?.sighted, 6000));
        this.attuned = new Set(idList(saved?.attuned, 400).filter(isWaystone));
        this.cleared = dayMap(saved?.cleared);
        this.used = dayMap(saved?.used);
        const ofKind = (value, limit, kind) => new Set(idList(value, limit).filter(id => poiById(id)?.kind === kind));
        this.leads = ofKind(saved?.leads, 1000, 'cairn');
        this.dug = new Set([...ofKind(saved?.dug, 1000, 'cairn')].filter(id => this.leads.has(id)));
        this.looted = ofKind(saved?.looted, 500, 'wreck');
        this.trades = new Map(Object.entries(saved?.trades && typeof saved.trades === 'object' ? saved.trades : {})
            .filter(([id, record]) => poiById(id)?.kind === 'trader' && Number.isFinite(record?.day) && Array.isArray(record.sold))
            .map(([id, record]) => [id, {day: Math.floor(record.day), sold: record.sold.slice(0, 8).map(count => Number.isFinite(count) ? Math.max(0, Math.min(99, Math.floor(count))) : 0)}]));
        this.fights.clear();
        for (const mesh of this.mounds.values()) mesh.dispose(false, true);
        this.mounds.clear();
        for (const [id, mesh] of this.meshes) if (isWaystone(id)) setRune(mesh, this.attuned.has(id));
    }
}

export { POI_KINDS };
