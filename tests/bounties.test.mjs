// Tests for bounties: what the notice boards post, and taking, doing and
// claiming a job through the real systems.
import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import {
    BOARD_KINDS, BOARD_DAYS, MAX_BOUNTIES, DEN_REACH, BOUNTY_KINDS, QUARRY,
    boardPeriod, nextPosting, bountyFor, bountyTitle, bountyReward, quarryName, validJob
} from '../js/bounties.js';
import { poisNear, poiById, WANTS, WORTH, DEN_REFILL_DAYS } from '../js/pois.js';
import { CREATURES } from '../js/creatures.js';
import { ITEMS } from '../js/resources.js';
import { BountySystem } from '../js/components/bounties.js';
import { PoiSystem } from '../js/components/pois.js';
import { AnimalSystem } from '../js/components/animals.js';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { BuildingSystem } from '../js/components/building.js';
import { GearSystem } from '../js/components/equipment.js';
import { BuffSystem } from '../js/components/buffs.js';
import { ProgressionSystem, STAT_LABELS } from '../js/components/progression.js';
import { SaveSystem } from '../js/components/save.js';
import { normalizeSettings } from '../js/settings.js';

globalThis.BABYLON = BABYLON;

const ALL = poisNear(0, 0, 1800);
const BOARDS = ALL.filter(poi => BOARD_KINDS.includes(poi.kind));
const jobs = (kind, days = 60) => {
    const found = [];
    for (const poi of BOARDS) for (let day = 1; day <= days; day += BOARD_DAYS) {
        const job = bountyFor(poi, day);
        if (job.kind === kind) found.push({poi, day, job});
    }
    return found;
};

function world() {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    engine.getDeltaTime = () => 50;
    scene.getAnimationRatio = () => 1;
    const notes = [], sounds = [], panels = [];
    const game = {
        scene, engine, paused: false, dayTime: 60, dayLength: 300, dayCount: 1, settings: normalizeSettings(null),
        audio: {play(name) { sounds.push(name); }},
        uiSystem: {
            showNotification(message) { notes.push(message); }, showLoot() {}, updateInventoryUI() {}, updateExperienceUI() {},
            updateHealthUI() {}, updateGearUI() {}, showLevelUpMessage() {}, setSaveStatus() {}, showDayBanner() {}, showGatherProgress() {},
            openTrade(id) { panels.push(id); }, openPanel() {}, closePanel() {}
        },
        terrainSystem: {
            waterHeight: 1, getPerlinHeight: () => 2, isWaterArea: () => false, isWithinSpawnArea: () => false,
            harvestedIds: new Set(), harvestedOn: new Map(), chunkMap: new Map(), checkChunkUpdates() {}
        },
        explorationSystem: {discovered: new Set(), isClearing: () => false},
        dungeonSystem: {active: false, runs: {}},
        registerModelShadow() {},
        effects: {torchLit: false, strike() {}, burst() {}, refreshHeld() {}}
    };
    const player = game.playerSystem = Object.create(PlayerSystem.prototype);
    const camera = new BABYLON.FreeCamera('body', new BABYLON.Vector3(0, 4, 0), scene);
    Object.assign(player, {game, camera, isDead: false, health: 100, maxHealth: 100, isGrounded: true, isFlying: false,
        jumpVelocity: 0, poisonLeft: 0, keys: {jump: false, descend: false, sprint: false}});
    game.inventorySystem = new InventorySystem(game);
    game.combatSystem = new CombatSystem(game);
    game.survivalSystem = new SurvivalSystem(game);
    game.buildSystem = new BuildingSystem(game);
    game.progression = new ProgressionSystem(game);
    game.gear = new GearSystem(game);
    game.buffs = new BuffSystem(game);
    game.animalSystem = new AnimalSystem(game);
    game.animalSystem.animals = [];
    const pois = game.pois = new PoiSystem(game);
    const bounties = game.bounties = new BountySystem(game);
    const stand = (poi, dx = 0, dz = 0) => { camera.position.x = poi.x + dx; camera.position.z = poi.z + dz; };
    const gearCount = () => Object.values(game.gear.equipped).filter(Boolean).length + game.gear.bag.length;
    const kill = kind => {
        const mesh = new BABYLON.Mesh(kind, scene);
        game.animalSystem.animals.push({kind, mesh});
        game.animalSystem.finish(game.animalSystem.animals.at(-1), game.animalSystem.animals.length - 1);
    };
    return {engine, game, camera, pois, bounties, notes, sounds, panels, stand, gearCount, kill};
}

// --- What the boards post ---------------------------------------------------
test('a board posts the same job for three days, then a new one', () => {
    assert.deepEqual([1, 2, 3, 4, 6, 7].map(boardPeriod), [0, 0, 0, 1, 1, 2]);
    assert.deepEqual([1, 3, 4, 6].map(nextPosting), [4, 4, 7, 7]);
    assert.equal(boardPeriod(NaN), 0);
    assert.ok(BOARDS.length > 60, 'plenty of boards within 1800 m');
    let changed = 0;
    for (const poi of BOARDS.slice(0, 80)) {
        const job = bountyFor(poi, 1);
        assert.deepEqual(bountyFor(poi, 2), job);
        assert.deepEqual(bountyFor(poi, 3), job);
        assert.equal(job.board, poi.id);
        assert.equal(job.period, 0);
        assert.equal(job.level, Math.max(1, poi.level));
        assert.equal(validJob(job), true);
        const later = bountyFor(poi, 4);
        assert.equal(later.period, 1);
        if (later.kind !== job.kind || later.target !== job.target) changed++;
    }
    assert.ok(changed > 25, 'plenty of boards post something different next time');
    for (const poi of ALL.filter(place => !BOARD_KINDS.includes(place.kind)).slice(0, 40)) assert.equal(bountyFor(poi, 1), null, poi.kind + ' has no board');
    assert.equal(bountyFor(null, 1), null);
});

test('hunts name the region\'s own hunters, deliveries its shortages, and den jobs a den nearby', () => {
    const hunts = jobs('hunt'), fetches = jobs('fetch'), clears = jobs('clear');
    assert.ok(hunts.length > 100 && fetches.length > 40 && clears.length > 100, 'all three kinds turn up');
    assert.deepEqual(BOUNTY_KINDS, ['hunt', 'fetch', 'clear']);
    for (const {poi, job} of hunts) {
        assert.ok((QUARRY[poi.region] || QUARRY.meadow).includes(job.target), `${poi.region} ${job.target}`);
        assert.ok(CREATURES[job.target]);
        assert.ok(job.need >= 3 && job.need <= 6);
        assert.equal(job.need, 3 + Math.min(3, job.level - 1), 'more of them further from home');
    }
    assert.ok(new Set(hunts.map(found => found.job.target)).size >= 4);
    for (const {poi, job} of fetches) {
        assert.equal(poi.kind, 'trader', 'only a trader can take delivery');
        assert.ok(WANTS[poi.region].includes(job.target));
        assert.ok(Object.hasOwn(ITEMS, job.target));
        assert.ok(WORTH[job.target] >= 1.5, 'never sixteen stones');
        assert.ok(job.need >= 2 && job.need <= 30);
        assert.ok(job.need * WORTH[job.target] >= 16, 'worth the piece of gear it pays');
    }
    for (const {poi, job} of clears) {
        const den = poiById(job.target);
        assert.equal(den.kind, 'den');
        assert.ok(Math.hypot(den.x - poi.x, den.z - poi.z) <= DEN_REACH);
        assert.equal(job.need, 1);
        // With that den empty, the board asks for the next nearest, or a hunt.
        const other = bountyFor(poi, job.period * BOARD_DAYS + 1, {denOpen: place => place.id !== den.id});
        assert.ok(other.kind === 'hunt' || (other.kind === 'clear' && other.target !== den.id));
        assert.equal(bountyFor(poi, job.period * BOARD_DAYS + 1, {denOpen: () => false}).kind, 'hunt');
    }
});

test('titles, rewards and the guard on saved jobs', () => {
    assert.equal(bountyTitle({kind: 'hunt', target: 'wolf', need: 3}), 'Wanted: 3 wolves');
    assert.equal(bountyTitle({kind: 'hunt', target: 'icewolf', need: 4}), 'Wanted: 4 ice wolves');
    assert.equal(bountyTitle({kind: 'fetch', target: 'fish', need: 4}), 'Wanted: 4 raw fish');
    assert.equal(bountyTitle({kind: 'clear', target: 'x', need: 1}, {name: 'Hollow Den'}), 'Wanted: Hollow Den cleared out');
    assert.equal(quarryName('toad', 1), 'bog toad');
    assert.equal(quarryName('scorpion'), 'scorpions');
    assert.deepEqual(bountyReward({level: 1}), {xp: 45, gearLevel: 2, luck: .5});
    assert.ok(bountyReward({level: 4}).xp > bountyReward({level: 1}).xp);
    const good = {board: 'poi:1:1', period: 0, level: 1, kind: 'hunt', target: 'wolf', need: 3};
    assert.equal(validJob(good), true);
    for (const bad of [null, {}, {...good, kind: 'steal'}, {...good, target: 'dragon'}, {...good, need: 0}, {...good, need: 2.5}, {...good, need: 999},
        {...good, level: 0}, {...good, period: -1}, {...good, board: 7}, {...good, kind: 'fetch', target: 'gold'}, {...good, kind: 'clear', target: 5}]) {
        assert.equal(validJob(bad), false, JSON.stringify(bad));
    }
});

// --- Taking, doing and claiming ------------------------------------------------
test('a hunt: take it at a trader, kill the quarry anywhere, come back for gear', () => {
    const {engine, game, bounties, notes, stand, gearCount, kill} = world();
    try {
        const {poi, day, job} = jobs('hunt').find(found => found.poi.kind === 'trader');
        game.dayCount = day;
        assert.equal(bounties.accept(poi.id), false, 'not from across the country');
        stand(poi, 2, 2);
        let board = bounties.board(poi);
        assert.deepEqual([board.state, board.action, board.button], ['open', 'accept', 'Take the job']);
        assert.equal(board.title, bountyTitle(job));
        assert.match(board.detail, /^A piece of gear and \d+ XP$/);
        assert.equal(bounties.actionable(poi), true);
        assert.equal(bounties.claim(poi.id), false, 'nothing to claim yet');
        assert.equal(bounties.accept(poi.id), true);
        assert.match(notes.at(-1), /^Bounty taken · \d+ /);
        assert.equal(bounties.accept(poi.id), false, 'one job to a board');
        board = bounties.board(poi);
        assert.deepEqual([board.state, board.action, board.button], ['active', null, 'In hand']);
        assert.match(board.detail, new RegExp(`^0 of ${job.need} · `));
        assert.equal(bounties.actionable(poi), false);

        // Other kills do not count; the right ones do, wherever they happen.
        stand(poi, 500, 500);
        kill('rabbit');
        assert.equal(bounties.progress(bounties.active.get(poi.id)).have, 0);
        for (let n = 1; n < job.need; n++) kill(job.target);
        assert.match(notes.at(-1), new RegExp(`^Bounty · ${job.need - 1} of ${job.need} `));
        assert.equal(bounties.claim(poi.id), false);
        kill(job.target);
        assert.match(notes.at(-1), new RegExp(`^Bounty done · claim it at ${poi.name}`));
        kill(job.target);
        assert.equal(bounties.active.get(poi.id).have, job.need, 'never more than asked');
        assert.match(bounties.list()[0], new RegExp(`^${job.need} of ${job.need} .* · claim at ${poi.name}$`));
        assert.equal(bounties.claim(poi.id), false, 'you have to go back to the board');

        stand(poi, 2, 2);
        board = bounties.board(poi);
        assert.deepEqual([board.state, board.action, board.button], ['done', 'claim', 'Claim']);
        const gear = gearCount(), xp = game.combatSystem.experience + game.combatSystem.level * 1e6;
        assert.equal(bounties.claim(poi.id), true);
        assert.equal(gearCount(), gear + 1);
        assert.ok(game.combatSystem.experience + game.combatSystem.level * 1e6 > xp);
        assert.equal(game.progression.stats.bounties, 1);
        assert.equal(STAT_LABELS.bounties, 'Bounties claimed');
        assert.equal(bounties.claim(poi.id), false, 'paid once');
        assert.equal(bounties.active.size, 0);

        // The board is bare until its next posting, and then has something new.
        board = bounties.board(poi);
        assert.deepEqual([board.state, board.action, board.title], ['claimed', null, 'Nothing posted']);
        assert.equal(board.detail, `A new notice goes up on day ${nextPosting(day)}`);
        assert.equal(bounties.accept(poi.id), false);
        game.dayCount = nextPosting(day);
        assert.equal(bounties.board(poi).state, 'open');
    } finally { engine.dispose(); }
});

test('a delivery is paid for out of your pack, and only when you have it all', () => {
    const {engine, game, bounties, stand, gearCount} = world();
    try {
        const {poi, day, job} = jobs('fetch')[0];
        const pack = game.inventorySystem.inventory;
        game.dayCount = day;
        stand(poi, 1, 1);
        assert.equal(bounties.accept(poi.id), true);
        pack[job.target] = job.need - 1;
        assert.deepEqual(bounties.progress(bounties.active.get(poi.id)), {have: job.need - 1, need: job.need, done: false});
        assert.equal(bounties.claim(poi.id), false);
        assert.equal(pack[job.target], job.need - 1, 'nothing taken');
        pack[job.target] = job.need + 3;
        assert.equal(bounties.board(poi).action, 'claim');
        assert.match(bounties.list()[0], new RegExp(`^${job.need} of ${job.need} `));
        const gear = gearCount();
        assert.equal(bounties.claim(poi.id), true);
        assert.equal(pack[job.target], 3, 'exactly what was asked for');
        assert.equal(gearCount(), gear + 1);
    } finally { engine.dispose(); }
});

test('a den job puts the den on your map and is done when you clear it afterwards', () => {
    const {engine, game, pois, bounties, stand} = world();
    try {
        const {poi, day, job} = jobs('clear')[0], den = poiById(job.target);
        game.dayCount = day;
        // Cleared long ago and lived in again: that old win must not count.
        pois.cleared.set(den.id, day - DEN_REFILL_DAYS - 2);
        stand(poi, 1, 1);
        assert.equal(bounties.board(poi).title, `Wanted: ${den.name} cleared out`);
        assert.equal(pois.sighted.has(den.id), false);
        assert.equal(bounties.accept(poi.id), true);
        assert.equal(pois.sighted.has(den.id), true, 'marked for you');
        assert.equal(bounties.progress(bounties.active.get(poi.id)).done, false);
        assert.match(bounties.board(poi).detail, /^Not yet done · /);
        assert.match(bounties.list()[0], new RegExp(`^${den.name} to clear · for ${poi.name}$`));
        pois.clearDen(den);
        assert.equal(bounties.progress(bounties.active.get(poi.id)).done, true);
        assert.match(bounties.board(poi).detail, /^Done · /);
        assert.equal(bounties.claim(poi.id), true);

        // A den that is empty today is not asked for.
        game.dayCount = nextPosting(day);
        const next = bounties.offer(poi);
        assert.ok(next.kind !== 'clear' || next.target !== den.id || game.dayCount - pois.cleared.get(den.id) >= DEN_REFILL_DAYS);
    } finally { engine.dispose(); }
});

test('a watchtower shows its notice when you climb it, and only when there is something to do', () => {
    const {engine, game, pois, bounties, panels, stand, kill} = world();
    try {
        const {poi, day, job} = jobs('hunt').find(found => found.poi.kind === 'tower');
        game.dayCount = day;
        stand(poi, 2, 2);
        assert.match(pois.interaction().label, /look around · there is a notice on the post$/);
        assert.equal(game.survivalSystem.interact(), true);
        assert.deepEqual(panels, [poi.id], 'the board opens after the look around');
        assert.equal(bounties.accept(poi.id), true);
        assert.equal(pois.interaction().label, 'Press E to climb the watchtower and look around');
        game.survivalSystem.interact();
        assert.equal(panels.length, 1, 'no panel for a job already in hand');
        for (let n = 0; n < job.need; n++) kill(job.target);
        assert.match(pois.interaction().label, /notice on the post$/);
        game.survivalSystem.interact();
        assert.equal(panels.length, 2, 'it opens again to pay you');
        assert.equal(bounties.claim(poi.id), true);
        game.survivalSystem.interact();
        assert.equal(panels.length, 2);
    } finally { engine.dispose(); }
});

test('three jobs in hand is the limit, and they survive a save', () => {
    const {engine, game, bounties, stand, kill} = world();
    try {
        const picks = [], seen = new Set();
        for (const found of jobs('hunt', 3)) if (!seen.has(found.poi.id) && picks.length < MAX_BOUNTIES + 1) { seen.add(found.poi.id); picks.push(found); }
        assert.equal(picks.length, MAX_BOUNTIES + 1);
        for (const {poi} of picks.slice(0, MAX_BOUNTIES)) { stand(poi, 1, 1); assert.equal(bounties.accept(poi.id), true); }
        const extra = picks[MAX_BOUNTIES].poi;
        stand(extra, 1, 1);
        const board = bounties.board(extra);
        assert.deepEqual([board.state, board.action, board.button], ['full', null, 'Hands full']);
        assert.equal(bounties.accept(extra.id), false);
        assert.equal(bounties.list().length, MAX_BOUNTIES);
        kill(picks[0].job.target);

        const items = new Map();
        const storage = {setItem(key, value) { items.set(key, value); }, getItem(key) { return items.get(key) || null; }, removeItem(key) { items.delete(key); }};
        const saves = game.saveSystem = new SaveSystem(game, storage);
        bounties.claimed.set(extra.id, 7);
        const before = JSON.stringify(bounties.capture());
        assert.equal(saves.save(), true);
        bounties.restore(null);
        assert.equal(bounties.active.size, 0);
        assert.equal(saves.load(), true);
        assert.equal(JSON.stringify(bounties.capture()), before);
        assert.ok(bounties.progress(bounties.active.get(picks[0].poi.id)).have >= 1, 'progress kept');

        // Nonsense in a save is dropped, not trusted.
        const good = bounties.capture().active[0];
        bounties.restore({active: [{...good, have: 999}, {...good, board: 'poi:home'}, 'junk'], claimed: {[extra.id]: 2, nowhere: 1, [good.board]: -3, x: 'y'}});
        assert.equal(bounties.active.size, 1);
        assert.equal(bounties.active.get(good.board).have, good.need, 'progress is capped at what was asked');
        assert.deepEqual([...bounties.claimed], [[extra.id, 2]]);
        bounties.restore({active: [{...good, board: 'nowhere'}, {...good, kind: 'fetch', target: 'gold'}, null]});
        assert.equal(bounties.active.size, 0);
        bounties.restore({active: 'no', claimed: []});
        assert.equal(bounties.active.size + bounties.claimed.size, 0);
    } finally { engine.dispose(); }
});
