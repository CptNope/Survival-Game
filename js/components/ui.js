import { ITEMS, RESOURCES, RECIPES, RECIPE_GROUPS, recipeDescription, hitsNeeded, itemAmount } from '../resources.js';
import { MAP_SPAN, MAP_CELLS, MAP_COLORS, mapCells, toSheet, onSheet } from '../map.js';
import { LEGEND_LIST } from '../legends.js';
import { REGIONS } from '../regions.js';
import { poiById } from '../pois.js';
import { CHEST_CAPACITY } from '../storage.js';
import { QUALITY_CHOICES, QUALITY_LABELS } from '../quality.js';
import { PERKS } from '../perks.js';
import { BUILDINGS } from './building.js';
import { STAT_LABELS } from './progression.js';
import { clockTime } from './sky.js';
import { WATERSKIN_CAPACITY } from './survival.js';
import { RARITIES, SLOTS, STATS, rarityIndex, describeStat, salvageValue } from '../gear.js';
import { BAG_SIZE } from './equipment.js';
import { GRID, FLOORS, cellOf, lineOfSight, dungeonsNear, STARTER_DUNGEON } from '../dungeon.js';
import { landmarksNear } from './exploration.js';
import { CREATURES } from '../creatures.js';

const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const rarityOf = item => RARITIES[rarityIndex(item.rarity)];

const BUILD_NOTES = {
    shelter: 'Shelter from the cold · a place to sleep', fire: 'Warmth · cooking · light',
    floor: 'Cabin foundation', wall: 'A wall for a cabin', roof: 'Cover from rain · a place to sleep',
    garden: 'Plant berries, herbs, mushrooms or cactus fruit · harvest more',
    chest: 'Holds 300 items · safe when you die',
    spikes: 'Hurts and staggers whatever hunts you · breaks after 10 catches',
    palisade: 'Stops hunters until they tear it down',
    watchfire: 'Hunters near it move slower · warmth'
};
// Map markers: [colour, SVG path in a 2-unit box, drawn as an outline?].
const MAP_MARKS = {
    site: ['#f4e3a1', 'M0 -1L1 0L0 1L-1 0Z'],
    dungeon: ['#c9a2ff', 'M-1 -.85L1 -.85L0 1Z'],
    lair: ['#ff6a55', 'M-.9 -.9L.9 .9M.9 -.9L-.9 .9', true],
    slain: ['#a3ada5', 'M-.9 -.9L.9 .9M.9 -.9L-.9 .9', true],
    // Points of interest. `seen` is only the key for hollow marks: places made out from a watchtower.
    seen: ['#e9eedc', 'M0 -.8A.8 .8 0 1 1 0 .8A.8 .8 0 1 1 0 -.8Z', true],
    tower: ['#e8c27a', 'M-.55 1L-.4 -.2L-.8 -.2L0 -1.1L.8 -.2L.4 -.2L.55 1Z'],
    waystone: ['#7fe3d2', 'M0 -1.15L.5 -.3L.36 1L-.36 1L-.5 -.3Z'],
    den: ['#ff9a6b', 'M-1 .75A1 1.15 0 0 1 1 .75Z'],
    denCleared: ['#a3ada5', 'M-1 .75A1 1.15 0 0 1 1 .75Z'],
    haven: ['#8fd98a', 'M0 -.9A.9 .9 0 1 1 0 .9A.9 .9 0 1 1 0 -.9Z'],
    trader: ['#ffd166', 'M-.8 -.3L-.3 -1L.3 -1L.8 -.3L.6 1L-.6 1Z'],
    shrine: ['#c9b6ff', 'M0 -1.1L1 -.2L.7 -.2L.7 1L-.7 1L-.7 -.2L-1 -.2Z'],
    cairn: ['#cfd6cf', 'M0 -1L.5 -.15L-.5 -.15ZM-.85 1L.85 1L.6 .05L-.6 .05Z'],
    cache: ['#ffd166', 'M-.8 -.8L.8 .8M.8 -.8L-.8 .8', true],
    wreck: ['#8ec7e8', 'M-1 -.05L1 -.05L.6 .95L-.6 .95ZM-.1 -1.1L.7 -.3L-.1 -.3Z'],
    camp: ['#ffb23e', 'M0 -1L1 -.1L.72 1L-.72 1L-1 -.1Z'],
    home: ['#ffffff', 'M0 -1.1L.29 -.34L1.05 -.34L.44 .16L.66 .92L0 .47L-.66 .92L-.44 .16L-1.05 -.34L-.29 -.34Z']
};
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = bearing => DIRECTIONS[(Math.round(bearing / (Math.PI / 4)) % 8 + 8) % 8];

export class UISystem {
    constructor(game) {
        this.game = game;
        this.panel = 'menu';
        this.started = false;
        this.lastRefresh = 0;
        this.gatherHint = null;
        const root = document.createElement('div');
        root.id = 'hud';
        root.classList.add('mobile-inventory-closed');
        // Small drawn icons: one stroke weight, no glyphs standing in for them.
        const chevron = (double, left) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"${left ? ' style="transform:scaleX(-1)"' : ''}><path d="${double ? 'M3 3l5 5-5 5M8 3l5 5-5 5' : 'M6 3l5 5-5 5'}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        this.icons = {take: chevron(false, true), takeAll: chevron(true, true), store: chevron(false, false), storeAll: chevron(true, false)};
        root.innerHTML = `
            <div id="hurt-vignette" aria-hidden="true"></div>
            <div id="effects-layer" aria-hidden="true"></div>
            <aside class="objective" aria-label="Current field note"><small id="objective-kicker" class="sr-only"></small><h2 id="objective-title">Make your first tool</h2><p id="objective-text"></p><span id="objective-progress"></span></aside>
            <div class="hud-status"><span id="world-clock"></span><span id="weather-status">Clear skies</span><span id="save-status" role="status">Autosave · Every 30s</span></div>
            <div class="hud-buttons"><button id="view-button" type="button" aria-label="Change camera view"><kbd>V</kbd><span>View</span></button><button id="menu-button" type="button" aria-label="Pause"><kbd>Esc</kbd><span>Pause</span></button></div>
            <div class="exploration-card" id="exploration-card" role="button" tabindex="0" aria-label="Open the map"><b id="compass-facing" aria-label="Facing">N</b><strong id="location-next">Finding the trail…</strong><span id="location-progress"></span><span id="dungeon-next"></span><span id="region-line"></span></div>
            <canvas id="minimap" width="186" height="186" hidden aria-label="Dungeon map"></canvas>
            <div id="boss-bar" hidden><small></small><progress max="100" value="100"></progress></div>
            <div id="crosshair" aria-hidden="true"></div><div id="draw-meter" aria-hidden="true"><i></i></div><div id="target-hint"></div>
            <div id="toast" role="status" aria-live="polite"></div>
            <div id="day-banner" aria-live="polite"><strong></strong><span></span></div>
            <div class="hud-chips"><button id="dog-button" type="button" hidden></button><button id="perk-button" type="button" hidden></button></div>
            <section class="vitals" aria-label="Condition"><small id="level"></small><progress id="experience" max="100" aria-label="Experience"></progress><label>Health <span id="health-value"></span></label><progress id="health" max="100"></progress><div id="oxygen-row" hidden><label>Oxygen <span id="oxygen-value"></span></label><progress id="oxygen" max="100"></progress></div><label>Hunger <span id="hunger-value"></span></label><progress id="hunger" max="100"></progress><label>Thirst <span id="thirst-value"></span></label><progress id="thirst" max="100"></progress><label>Cold <span id="cold-value"></span></label><progress id="cold" max="100"></progress><div id="buffs" aria-live="off"></div></section>
            <section id="inventory" class="inventory" aria-label="Pack"></section>
            <nav class="hud-menu" aria-label="Menus"><button id="craft-button" type="button"><kbd>C</kbd><span>Craft</span></button><button id="building-button" type="button"><kbd>B</kbd><span>Build</span></button><button id="gear-button" type="button"><kbd>G</kbd><span>Gear</span><b id="gear-count" hidden></b></button><button id="map-button" type="button"><kbd>N</kbd><span>Map</span></button><button id="inventory-toggle" type="button" aria-expanded="false" aria-controls="inventory">Pack</button></nav>
            <div id="fade" aria-hidden="true"></div>
            <div id="death-screen" hidden role="alert"><div><small id="death-kicker"></small><h1>The wilds claimed you.</h1><p id="death-cause"></p><p>Your supplies lie where you fell. Returning to the clearing…</p></div></div>
            <div id="modal" class="modal"><section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
                <nav id="panel-tabs" class="panel-tabs" aria-label="Sections"><button type="button" data-panel="menu">Paused</button><button type="button" data-panel="craft">Craft</button><button type="button" data-panel="build">Build</button><button type="button" data-panel="gear">Gear</button><button type="button" data-panel="perks">Perks</button><button type="button" data-panel="map">Map</button></nav>
                <div class="panel-body">
                    <header class="panel-head"><small id="panel-kicker" class="sr-only"></small><h1 id="panel-title">The Wilds</h1><p id="panel-copy">Explore the wilderness, gather supplies, and craft the tools to keep going.</p></header>
                    <div id="recipes"></div><div id="build-options"></div><div id="gear-panel"></div><div id="perk-panel"></div><div id="storage-panel"></div><div id="trade-panel"></div><div id="map-panel"><div id="map-travel" class="map-travel" hidden></div><canvas id="map-canvas" width="540" height="540" aria-label="Map of the country around you"></canvas><ul id="map-legend"></ul></div>
                    <div id="settings"><label for="set-volume">Sound</label><input id="set-volume" type="range" min="0" max="100" step="5"><button id="set-mute" type="button">Mute</button><label for="set-sensitivity">Look speed</label><input id="set-sensitivity" type="range" min="30" max="250" step="10"><span id="sensitivity-value"></span><span class="settings-label" id="quality-label">Graphics</span><div id="set-quality" role="group" aria-labelledby="quality-label">${QUALITY_CHOICES.map(choice => `<button type="button" data-quality="${choice}">${QUALITY_LABELS[choice]}</button>`).join('')}</div><span id="quality-value"></span></div>
                    <details id="controls-wrap"><summary>Controls</summary><div id="controls"></div></details>
                    <dl id="stats"></dl>
                </div>
                <footer class="panel-foot"><button id="save-now" type="button">Save now</button><button id="new-game" type="button">Start a new expedition</button><button id="resume" class="primary" type="button">Enter the wilds</button></footer></section></div>`;
        document.body.append(root);
        this.$ = id => document.getElementById(id);
        this.$('menu-button').onclick = () => this.toggleMenu();
        this.$('craft-button').onclick = () => this.toggleCrafting();
        this.$('building-button').onclick = () => this.toggleBuilding();
        this.$('gear-button').onclick = () => this.toggleGear();
        this.$('view-button').onclick = () => { if (!game.paused) game.viewSystem?.cycle(); };
        this.$('perk-button').onclick = () => this.togglePerks();
        this.$('exploration-card').onclick = () => this.toggleMap();
        this.$('exploration-card').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.toggleMap(); } };
        this.$('map-button').onclick = () => this.toggleMap();
        this.$('trade-panel').onclick = event => {
            const line = event.target.closest('button[data-offer]');
            if (line && game.pois?.trade(this.tradeId, Number(line.dataset.offer))) this.updateTradeUI();
            const job = event.target.closest('button[data-bounty]');
            if (job && game.bounties?.[job.dataset.bounty === 'claim' ? 'claim' : 'accept'](this.tradeId)) this.updateTradeUI();
        };
        this.$('map-travel').onclick = event => {
            const choice = event.target.closest('button[data-travel]');
            if (choice) game.pois?.travel(choice.dataset.travel);
        };
        // The tabs along the top of a panel: move between sections without closing it.
        this.$('panel-tabs').onclick = event => {
            const tab = event.target.closest('button[data-panel]');
            if (!tab || tab.dataset.panel === this.panel) return;
            if (tab.dataset.panel === 'map' && game.dungeonSystem?.active) { this.showNotification('No map underground · the corner chart shows this floor'); return; }
            this.openPanel(tab.dataset.panel);
        };
        this.$('set-quality').onclick = event => {
            const button = event.target.closest('button[data-quality]');
            if (button && game.quality?.setChoice(button.dataset.quality)) { game.audio?.play('click'); this.syncSettings(); }
        };
        this.$('dog-button').onclick = () => game.companion?.toggleMode();
        this.$('storage-panel').onclick = event => {
            const button = event.target.closest('button[data-move]');
            if (!button) return;
            const amount = button.dataset.amount === 'all' ? 'all' : 1;
            game.storage[button.dataset.move](this.storageId, button.dataset.item, amount);
            this.updateStorageUI();
        };
        this.$('perk-panel').onclick = event => {
            const button = event.target.closest('button[data-perk]');
            if (button && game.perks.choose(button.dataset.perk)) this.updatePerkUI();
        };
        // One listener serves every button in the gear panel.
        this.$('gear-panel').onclick = event => {
            const button = event.target.closest('button[data-gear]');
            if (!button) return;
            const gear = game.gear, {gear: action, id} = button.dataset;
            if (action === 'equip') gear.equip(id);
            else if (action === 'unequip') gear.unequip(id);
            else if (action === 'salvage') gear.salvage(id);
            else if (action === 'clear') gear.salvageBelow(id);
        };
        this.$('inventory-toggle').onclick = () => {
            const hidden = root.classList.toggle('mobile-inventory-closed');
            this.$('inventory-toggle').setAttribute('aria-expanded', String(!hidden));
        };
        this.$('save-now').onclick = () => {
            if (game.saveSystem.save()) this.showNotification('Expedition saved on this device');
            else this.showNotification('Local saving unavailable');
        };
        this.$('new-game').onclick = () => {
            const button = this.$('new-game');
            if (!button.classList.contains('confirm')) {
                button.classList.add('confirm');
                button.textContent = 'Erase this expedition? Click again to confirm';
                return;
            }
            game.saveSystem.clear();
            location.reload();
        };
        this.$('resume').onclick = () => this.closePanel();
        this.$('set-volume').oninput = event => {
            game.updateSettings({volume: Number(event.target.value) / 100, muted: false});
            this.syncSettings();
        };
        this.$('set-volume').onchange = () => { game.audio?.unlock(); game.audio?.play('collect'); };
        this.$('set-sensitivity').oninput = event => {
            game.updateSettings({sensitivity: Number(event.target.value) / 100});
            this.syncSettings();
        };
        this.$('set-mute').onclick = () => {
            game.updateSettings({muted: !game.settings.muted});
            this.syncSettings();
        };
        this.$('recipes').innerHTML = Object.entries(RECIPE_GROUPS).map(([group, label]) =>
            `<h3>${label}</h3>` + Object.entries(RECIPES).filter(([, recipe]) => recipe.group === group).map(([id, recipe]) =>
                `<button class="recipe" data-recipe="${id}"><strong>${recipe.name}</strong><span>${recipeDescription(recipe)}${recipe.note ? ' · ' + recipe.note : ''}</span><b>${recipe.heal || recipe.hunger ? 'Use +' : 'Craft +'}</b></button>`).join('')).join('');
        this.$('recipes').querySelectorAll('button').forEach(button => button.onclick = () => {
            if (!game.inventorySystem.craft(button.dataset.recipe)) game.audio?.play('deny');
        });
        this.$('build-options').innerHTML = Object.entries(BUILDINGS).map(([id, blueprint]) =>
            `<button class="recipe" data-building="${id}"><strong>${blueprint.name}</strong><span>${Object.entries(blueprint.cost).map(([resource,cost])=>`${cost} ${ITEMS[resource]}`).join(' · ')} · ${BUILD_NOTES[id] || ''}</span><b>Place →</b></button>`).join('');
        this.$('build-options').querySelectorAll('button').forEach(button => button.onclick = () => {
            // Choosing a structure returns to the world with a movable preview.
            this.closePanel();
            game.buildSystem.beginPlacement(button.dataset.building);
        });
        this.syncSettings();
        this.renderPanel();
        this.updateInventoryUI();
    }
    openPanel(panel) {
        if (this.game.playerSystem?.isDead) return;
        this.panel = panel;
        this.game.setPaused(true);
        this.game.buildSystem?.cancelPlacement?.();
        this.updateInventoryUI();
        this.renderPanel();
    }
    closePanel() {
        this.panel = null;
        this.started = true;
        this.game.setPaused(false);
        this.renderPanel();
        // Movement keys are read from the canvas, so hand it the keyboard
        // back: otherwise W A S D stay dead after using a panel button.
        const canvas = this.game.engine.getRenderingCanvas();
        if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
        canvas.focus({preventScroll: true});
        if (!this.game.touchControls?.enabled)
            canvas.requestPointerLock?.()?.catch?.(() => {});
    }
    toggleMenu() { this.panel === 'menu' ? this.closePanel() : this.openPanel('menu'); }
    toggleCrafting() { this.panel === 'craft' ? this.closePanel() : this.openPanel('craft'); }
    toggleBuilding() { this.panel === 'build' ? this.closePanel() : this.openPanel('build'); }
    toggleGear() { this.panel === 'gear' ? this.closePanel() : this.openPanel('gear'); }
    togglePerks() { this.panel === 'perks' ? this.closePanel() : this.openPanel('perks'); }
    openStorage(id) { this.storageId = id; this.openPanel('storage'); }
    openTrade(id) { this.tradeId = id; this.openPanel('trade'); }
    toggleMap() {
        if (this.game.dungeonSystem?.active) { this.showNotification('No map underground · the corner chart shows this floor'); return; }
        this.panel === 'map' ? this.closePanel() : this.openPanel('map');
    }
    setSaveStatus(message) { this.$('save-status').textContent = message; }
    syncSettings() {
        const settings = this.game.settings;
        if (!settings) return;
        this.$('set-volume').value = String(Math.round((settings.muted ? 0 : settings.volume) * 100));
        this.$('set-sensitivity').value = String(Math.round(settings.sensitivity * 100));
        this.$('sensitivity-value').textContent = settings.sensitivity.toFixed(1) + '×';
        this.$('set-mute').textContent = settings.muted ? 'Unmute' : 'Mute';
        this.$('set-mute').setAttribute('aria-pressed', String(settings.muted));
        const quality = this.game.quality;
        for (const button of this.$('set-quality').children) {
            const chosen = button.dataset.quality === (quality?.choice || 'auto');
            button.classList.toggle('current', chosen);
            button.setAttribute('aria-pressed', String(chosen));
        }
        this.$('quality-value').textContent = quality?.choice === 'auto' ? quality.describe().replace('Auto · ', 'Now: ') : '';
    }
    renderPanel() {
        const build = this.panel === 'build', craft = this.panel === 'craft', gear = this.panel === 'gear', perks = this.panel === 'perks';
        const map = this.panel === 'map', storage = this.panel === 'storage', trade = this.panel === 'trade';
        const menu = !build && !craft && !gear && !perks && !map && !storage && !trade;
        this.$('storage-panel').hidden = !storage;
        if (storage) this.updateStorageUI();
        this.$('trade-panel').hidden = !trade;
        if (trade) this.updateTradeUI();
        this.$('map-panel').hidden = !map;
        if (map) this.drawMap();
        this.$('gear-panel').hidden = !gear;
        if (gear) this.updateGearUI();
        this.$('perk-panel').hidden = !perks;
        if (perks) this.updatePerkUI();
        const title = menu && !this.started;
        this.$('modal').hidden = !this.panel;
        this.$('recipes').hidden = !craft;
        this.$('build-options').hidden = !build;
        this.$('controls').hidden = !menu;
        this.$('settings').hidden = !menu;
        this.$('stats').hidden = !menu || title;
        this.$('new-game').hidden = !menu;
        this.$('new-game').classList.remove('confirm');
        this.$('new-game').textContent = 'Start a new expedition';
        if (menu) {
            const rows = list => '<dl class="key-list">' + list.map(([keys, action]) => `<div><dt>${keys.split(' ').map(key => `<kbd>${key}</kbd>`).join('')}</dt><dd>${action}</dd></div>`).join('') + '</dl>';
            this.$('controls').innerHTML = this.game.touchControls?.enabled
                ? rows([['Stick', 'Move'], ['Drag', 'Look around; pinch to zoom the outside views'], ['HIT', 'Hold to gather or attack; tap to cast a line'], ['USE', 'Drink, sleep, open chests, plant, use places, take doors and stairs'], ['JUMP', 'Jump; double tap to fly'], ['RUN', 'Hold to sprint'], ['DODGE', 'A short dash that blows miss'], ['HEAL', 'Use your best remedy'], ['BOW', 'Hold to draw, let go to loose'], ['TORCH', 'Light or put away the torch'], ['SKILL', 'Heavy sweep; cancels building'], ['DOWN', 'Descend while flying, or dive'], ['View', 'First-person, third-person or overhead'], ['Compass', 'Tap for the map']])
                : rows([['W A S D', 'Move'], ['Shift', 'Sprint'], ['Click', 'Hold to gather or attack; cast a line'], ['Right-click', 'Heavy sweep; cancels building'], ['E', 'Drink, sleep, open chests, plant, use places, take doors and stairs'], ['Space', 'Jump; double tap to fly'], ['Ctrl', 'Descend or dive'], ['Q', 'Dodge'], ['H', 'Quick heal'], ['R', 'Hold to draw the bow; rotates a build preview'], ['F', 'Torch'], ['V', 'Change view; mouse wheel zooms'], ['T', 'Dog: stay or follow'], ['C B G', 'Craft, Build, Gear'], ['K N', 'Perks, Map'], ['M P', 'Mute, Save'], ['Esc', 'Pause']]);
            const progression = this.game.progression;
            if (progression) this.$('stats').innerHTML = `<div><dt>Day</dt><dd>${this.game.dayCount}</dd></div><div><dt>Field notes</dt><dd>${progression.completed.size}</dd></div>` +
                Object.entries(STAT_LABELS).map(([key, label]) => `<div><dt>${label}</dt><dd>${progression.stats[key]}</dd></div>`).join('');
        }
        this.$('save-now').hidden = !menu || title;
        // The heading names the panel; the line under it says what it is for.
        this.$('panel-title').textContent = trade ? (poiById(this.tradeId)?.name || 'Trader') : storage ? 'Storage chest' : map ? 'Map' : perks ? 'Perks' : gear ? 'Gear'
            : build ? 'Build' : craft ? 'Craft' : title ? 'The Wilds' : 'Paused';
        this.$('panel-kicker').textContent = '';
        for (const tab of this.$('panel-tabs').children) {
            const current = tab.dataset.panel === this.panel;
            tab.classList.toggle('current', current);
            if (current) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
        }
        this.$('panel-tabs').hidden = title || !this.panel;
        this.$('modal').dataset.panel = this.panel || '';
        // Controls are open on a first visit and folded away after that.
        this.$('controls-wrap').hidden = !menu;
        if (menu) this.$('controls-wrap').open = title || !this.game.touchControls?.enabled;
        this.$('panel-copy').textContent = trade
            ? (poiById(this.tradeId)?.kind === 'trader'
                ? 'A job on the notice board, and what the trader will swap today. Each line can be had twice, and there is one piece of gear. The stall changes every morning.'
                : 'A notice is nailed to the foot of the tower. Take the job, do it, and come back here to be paid.')
            : storage
            ? 'Move things between your pack and this chest. Whatever is in a chest stays there if you die.'
            : map
            ? 'North is up. Country you have not set foot in stays dark until you reach a region of its kind.'
            : perks
            ? 'Every level after the first earns a point. Spend it on one of three perks; the choice is permanent.'
            : gear
            ? 'Gear is graded by the bonuses it rolled, from Common to Legendary. You keep it when you fall.'
            : build
            ? (this.game.touchControls?.enabled
                ? 'Choose a structure, then aim where it should stand. HIT places it and SKILL cancels.'
                : 'Choose a structure, then aim where it should stand. Click to place it, R to rotate, Esc to cancel.')
            : craft ? 'Better tools gather faster. Food and dressings work straight from your pack.'
            : title ? 'Gather, craft and build before nightfall. The cold, hunger and wolves will not wait.'
            : 'Follow your field notes, keep a fire going, and rest in a shelter at night. Progress saves on this device.';
        const returning = this.game.dayCount > 1 || this.game.progression?.completed.size > 0;
        this.$('resume').textContent = build || craft || gear || perks || map || storage || trade ? 'Back to the wilds'
            : title ? (returning ? `Continue expedition · Day ${this.game.dayCount}` : 'Enter the wilds') : 'Return to the wilds';
        if (this.panel) {
            // Focus the way out without scrolling the long crafting list to its end.
            this.$('resume').focus({preventScroll: true});
            this.$('modal').querySelector('.panel-body').scrollTop = 0;
        }
        this.$('hud').classList.toggle('touch', Boolean(this.game.touchControls?.enabled));
        this.updateGearButton();
    }
    // --- Storage ------------------------------------------------------------
    updateStorageUI() {
        const storage = this.game.storage, id = this.storageId, rows = storage.rows(id);
        const used = CHEST_CAPACITY - storage.room(id);
        const move = (action, item, amount, label, enabled) =>
            `<button type="button" data-move="${action}" data-item="${item}" data-amount="${amount}"${enabled ? '' : ' disabled'} aria-label="${action === 'store' ? 'Store' : 'Take'} ${amount === 'all' ? 'all' : 'one'} ${ITEMS[item].toLowerCase()}">${label}</button>`;
        this.$('storage-panel').innerHTML = `<h3>${used} of ${CHEST_CAPACITY} stored</h3>`
            + (rows.length ? `<table class="storage-table"><thead><tr><th>Item</th><th>Pack</th><th></th><th>Chest</th></tr></thead><tbody>${rows.map(row =>
                `<tr><th scope="row">${row.name}</th><td>${row.carried}</td><td class="storage-moves">${move('take', row.item, 'all', this.icons.takeAll, row.stored > 0)}${move('take', row.item, 1, this.icons.take, row.stored > 0)}${move('store', row.item, 1, this.icons.store, row.carried > 0)}${move('store', row.item, 'all', this.icons.storeAll, row.carried > 0)}</td><td>${row.stored}</td></tr>`).join('')}</tbody></table>`
                : '<p class="empty-pack">Nothing to store yet · the chest and your pack are both empty</p>');
    }
    // --- Trading ------------------------------------------------------------
    updateTradeUI() {
        const game = this.game, poi = poiById(this.tradeId), box = this.$('trade-panel');
        if (!box || !poi || !game.pois) return;
        const inventory = game.inventorySystem.inventory;
        const goods = bundle => Object.entries(bundle).map(([item, amount]) => item === 'torch' && amount !== 1 ? `${amount} torches` : itemAmount(item, amount)).join(' and ');
        const purse = bundle => Object.entries(bundle).map(([item]) => `you have ${inventory[item] || 0}`).join(', ');
        // The notice board comes first; a watchtower has nothing else to offer.
        const board = game.bounties?.board(poi);
        const notice = board ? `<h3 class="board-head">Notice board</h3><button type="button" class="recipe bounty" ${board.action ? `data-bounty="${board.action}"` : 'disabled'}>`
            + `<strong>${board.title}</strong><span>${board.detail}</span><b>${board.button}</b></button>` : '';
        const stall = poi.kind === 'trader' ? '<h3 class="board-head">Trade</h3>' : '';
        box.innerHTML = notice + stall + (poi.kind !== 'trader' ? [] : game.pois.offers(poi)).map(offer =>
            `<button type="button" class="recipe" data-offer="${offer.index}" ${offer.affordable ? '' : 'disabled'}><strong>${offer.gear ? 'A piece of gear, unseen' : goods(offer.get)}</strong>`
            + `<span>for ${goods(offer.give)} · ${purse(offer.give)}</span><b>${offer.left ? (offer.affordable ? 'Trade' : 'Too dear') : 'Sold out'}</b></button>`).join('');
    }
    // --- Map ----------------------------------------------------------------
    // Everything worth marking, nearest things last so they draw on top.
    mapMarks() {
        const game = this.game, position = game.playerSystem.camera.position, reach = MAP_SPAN * .75, marks = [];
        for (const site of landmarksNear(position.x, position.z, reach))
            if (game.explorationSystem?.discovered.has(site.id)) marks.push({kind: 'site', label: site.name, x: site.x, z: site.z});
        for (const site of dungeonsNear(position.x, position.z, reach))
            if (game.dungeonSystem?.runs[site.id] || site.id === STARTER_DUNGEON.id) marks.push({kind: 'dungeon', label: site.name, x: site.x, z: site.z});
        for (const legend of LEGEND_LIST) {
            if (!game.regions?.discovered.has(legend.region)) continue;
            const lair = game.legends?.lair(legend.region);
            if (lair) marks.push({kind: game.legends.slain.has(legend.id) ? 'slain' : 'lair', label: legend.name, x: lair.x, z: lair.z});
        }
        marks.push(...(game.pois?.mapMarks(position, reach) || []));
        const camp = game.buildSystem.structures.find(item => item.type === 'shelter') || game.buildSystem.structures.find(item => item.type === 'fire');
        if (camp) marks.push({kind: 'camp', label: 'Your camp', x: camp.x, z: camp.z});
        marks.push({kind: 'home', label: 'The clearing', x: 0, z: 0});
        return marks;
    }
    drawMap() {
        const canvas = this.$('map-canvas'), context = canvas.getContext?.('2d');
        if (!context) return;
        const game = this.game, position = game.playerSystem.camera.position, size = canvas.width, cell = size / MAP_CELLS;
        const cells = mapCells(position.x, position.z, game.regions.discovered, (x, z) => game.terrainSystem.isWaterArea(x, z));
        for (let n = 0; n < cells.length; n++) {
            context.fillStyle = MAP_COLORS[cells[n]];
            context.fillRect((n % MAP_CELLS) * cell, Math.floor(n / MAP_CELLS) * cell, Math.ceil(cell), Math.ceil(cell));
        }
        const shown = new Map();
        let hollow = 0;
        for (const mark of this.mapMarks()) {
            const point = toSheet(mark.x, mark.z, position.x, position.z, size);
            if (!onSheet(point, size, 10)) continue;
            const [colour, path, lined] = MAP_MARKS[mark.kind], outline = lined || mark.seen;
            context.save(); context.translate(point.px, point.py); context.scale(mark.seen ? 6 : 7.5, mark.seen ? 6 : 7.5);
            const shape = new Path2D(path);
            context.lineJoin = 'round'; context.lineCap = 'round';
            context.lineWidth = outline ? .62 : .44; context.strokeStyle = '#0d1512'; context.stroke(shape);
            if (outline) { context.lineWidth = .3; context.strokeStyle = colour; context.stroke(shape); }
            else { context.fillStyle = colour; context.fill(shape); }
            context.restore();
            if (mark.seen) { hollow++; continue; }
            if (!shown.has(mark.kind)) shown.set(mark.kind, []);
            shown.get(mark.kind).push(mark.label);
        }
        // You: an arrowhead pointing the way you face.
        const yaw = game.playerSystem.camera.rotation.y;
        context.save(); context.translate(size / 2, size / 2); context.rotate(yaw);
        context.beginPath(); context.moveTo(0, -11); context.lineTo(7, 8); context.lineTo(0, 4); context.lineTo(-7, 8); context.closePath();
        context.fillStyle = '#ffffff'; context.strokeStyle = '#0d1512'; context.lineWidth = 2; context.fill(); context.stroke(); context.restore();
        const names = {site: 'Landmarks found', dungeon: 'Ways underground', lair: 'Lairs', slain: 'Lairs, emptied', camp: 'Your camp', home: 'The clearing',
            tower: 'Watchtowers', waystone: 'Waystones', den: 'Dens', denCleared: 'Dens, cleared', haven: 'Havens',
            trader: 'Traders', shrine: 'Shrines', cairn: 'Cairns', cache: 'Buried caches', wreck: 'Wrecks'};
        const key = (path, colour, outline) => `<svg viewBox="-1.5 -1.5 3 3" width="14" height="14" aria-hidden="true"><path d="${path}" ${outline ? `fill="none" stroke="${colour}" stroke-width=".34" stroke-linecap="round"` : `fill="${colour}"`}/></svg>`;
        this.$('map-legend').innerHTML = `<li>${key('M0 -1.2L.8 1L0 .55L-.8 1Z', '#fff')} You · ${game.regions.def.name}</li>`
            + [...shown].map(([kind, labels]) => `<li>${key(MAP_MARKS[kind][1], MAP_MARKS[kind][0], MAP_MARKS[kind][2])} ${names[kind]}${['lair', 'slain'].includes(kind) ? ' · ' + [...new Set(labels)].join(', ') : ''}</li>`).join('')
            + (hollow ? `<li>${key(MAP_MARKS.seen[1], MAP_MARKS.seen[0], true)} Hollow marks · seen from a watchtower</li>` : '')
            + `<li class="map-scale">${MAP_SPAN}m across · ${game.explorationSystem?.discovered.size || 0} landmarks and ${game.pois?.found.size || 0} points of interest found</li>`
            + (game.seasons ? `<li class="map-scale">${game.seasons.calendar}</li>` : '')
            + (game.raids ? `<li class="map-scale">${game.raids.next === game.dayCount ? 'A pack hunts tonight' : `The next pack hunts on the night of day ${game.raids.next}`}</li>` : '')
            + (game.bounties?.list() || []).map(line => `<li class="map-scale">Bounty · ${line}</li>`).join('');
        this.drawTravel();
    }
    // Under the map: where the waystone you are standing at can send you.
    drawTravel() {
        const box = this.$('map-travel'), pois = this.game.pois;
        if (!box) return;
        const options = pois?.travelOptions() || [], woken = pois?.attuned.size || 0;
        box.hidden = !woken;
        box.innerHTML = options.length
            ? '<h3>Travel from this waystone</h3>' + options.map(option =>
                `<button type="button" class="recipe" data-travel="${option.id}"><strong>${option.name}</strong><span>${Math.round(option.distance)} m ${compass(option.bearing)} · ${REGIONS[option.region]?.name || ''}</span><b>Go</b></button>`).join('')
            : `<p>${woken === 1 ? 'One waystone woken' : woken + ' waystones woken'} · stand at one to travel between them</p>`;
    }
    // --- Perks --------------------------------------------------------------
    updatePerkUI() {
        const perks = this.game.perks, points = perks.available(), offer = perks.offer();
        const numeral = rank => 'I'.repeat(rank);
        const cards = offer.map(id => {
            const perk = PERKS[id], rank = perks.ranks[id] || 0;
            return `<button class="recipe perk" data-perk="${id}"><strong>${perk.name}${perk.max > 1 ? ' ' + numeral(rank + 1) : ''}</strong><span>${perk.text}${rank ? ` · you have ${numeral(rank)}` : ''}</span><b>Choose +</b></button>`;
        }).join('');
        const owned = perks.list().map(perk => `<li><strong>${perk.name}${perk.rank > 1 ? ' ' + numeral(perk.rank) : ''}</strong> ${perk.text}${perk.rank > 1 ? ` (×${perk.rank})` : ''}</li>`).join('');
        this.$('perk-panel').innerHTML = (points
            ? `<h3>${points} point${points === 1 ? '' : 's'} to spend · choose one</h3>${cards}`
            : `<p class="empty-pack">No points to spend · the next comes at level ${this.game.combatSystem.level + 1}</p>`)
            + (owned ? `<h3>Your perks</h3><ul class="perk-list">${owned}</ul>` : '');
        this.updatePerkButton();
    }
    updatePerkButton() {
        const points = this.game.perks?.available() || 0, button = this.$('perk-button');
        button.hidden = !points;
        button.textContent = this.game.touchControls?.enabled ? `Perk ready${points > 1 ? ' ×' + points : ''}` : `K · Perk ready${points > 1 ? ' ×' + points : ''}`;
    }
    // --- Gear ---------------------------------------------------------------
    gearCard(item, worn, equipped) {
        const grade = rarityOf(item);
        const stats = Object.entries(item.stats).map(([stat, value]) => {
            const delta = equipped ? 0 : value - (worn?.stats[stat] || 0);
            const change = equipped || !worn ? '' : delta > 0 ? ` <i class="up">▲ ${+delta.toFixed(1)}</i>` : delta < 0 ? ` <i class="down">▼ ${+(-delta).toFixed(1)}</i>` : '';
            return `<li>${describeStat(stat, value)}${change}</li>`;
        });
        // Bonuses the worn piece has that this one would give up.
        if (!equipped && worn) for (const [stat, value] of Object.entries(worn.stats)) {
            if (!(stat in item.stats)) stats.push(`<li class="lost">Loses ${describeStat(stat, value).slice(1)}</li>`);
        }
        const upgrade = !equipped && this.game.gear.isUpgrade(item) ? '<em>Upgrade</em>' : '';
        const actions = equipped
            ? `<button type="button" data-gear="unequip" data-id="${item.slot}">Take off</button>`
            : `<button type="button" data-gear="equip" data-id="${item.id}">Equip</button><button type="button" data-gear="salvage" data-id="${item.id}">Break down · ${salvageValue(item).xp} XP</button>`;
        return `<article class="gear-card" style="--rarity:${grade.color}"><header><strong>${escapeHtml(item.name)}</strong>${upgrade}</header>
            <small>${grade.name} ${SLOTS[item.slot].toLowerCase()} · Level ${item.level}</small><ul>${stats.join('')}</ul><div class="gear-actions">${actions}</div></article>`;
    }
    updateGearUI() {
        const gear = this.game.gear;
        if (!gear) return;
        this.updateGearButton();
        if (this.panel !== 'gear') return;
        const slots = Object.entries(SLOTS).map(([slot, label]) => {
            const item = gear.equipped[slot];
            return `<section><h3>${label}</h3>${item ? this.gearCard(item, null, true) : '<p class="gear-empty">Nothing equipped</p>'}</section>`;
        }).join('');
        const totals = Object.entries(gear.totals).filter(([, value]) => value > 0)
            .map(([stat, value]) => `<span>${describeStat(stat, value)}${value >= STATS[stat].cap ? ' (max)' : ''}</span>`).join('');
        const bag = [...gear.bag].sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level);
        const commons = gear.bag.filter(item => rarityIndex(item.rarity) < 2).length;
        this.$('gear-panel').innerHTML = `<div class="gear-slots">${slots}</div>
            <div class="gear-totals">${totals || '<span>No bonuses yet · Open chests in the dungeons to find gear</span>'}</div>
            <div class="gear-bag-head"><h3>Bag · ${gear.bag.length} / ${BAG_SIZE}</h3>${commons > 1 ? `<button type="button" data-gear="clear" data-id="rare">Break down ${commons} below Rare</button>` : ''}</div>
            <div class="gear-bag">${bag.map(item => this.gearCard(item, gear.equipped[item.slot], false)).join('') || '<p class="gear-empty">Your bag is empty.</p>'}</div>`;
    }
    updateGearButton() {
        const gear = this.game.gear, button = this.$('gear-button');
        if (!gear || !button) return;
        const upgrades = gear.bag.filter(item => gear.isUpgrade(item)).length;
        const count = this.$('gear-count');
        count.hidden = !upgrades;
        count.textContent = upgrades || '';
        button.setAttribute('aria-label', upgrades ? `Gear, ${upgrades} upgrade${upgrades === 1 ? '' : 's'} in the bag` : 'Gear');
        button.classList.toggle('has-upgrade', upgrades > 0);
    }
    // A found item, announced in its rarity colour.
    showLoot(item, verb = 'Found') {
        const grade = rarityOf(item);
        const toast = this.$('toast');
        toast.innerHTML = `${verb}: <b style="color:${grade.color}">${escapeHtml(item.name)}</b> · ${grade.name} ${SLOTS[item.slot].toLowerCase()}`;
        toast.classList.add('visible');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3800);
    }
    // --- Dungeon HUD --------------------------------------------------------
    drawMinimap() {
        const dungeon = this.game.dungeonSystem, canvas = this.$('minimap');
        const layout = dungeon.layout, ctx = canvas.getContext?.('2d');
        if (!layout || !ctx) return;
        const size = canvas.width / GRID, position = this.game.playerSystem.camera.position;
        const at = (x, y) => [x * size, (GRID - 1 - y) * size]; // North is up.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(8,13,12,.82)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const seen = (x, y) => dungeon.explored[y * GRID + x] === 1;
        ctx.fillStyle = '#6f7d74';
        for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
            if (seen(x, y)) ctx.fillRect(...at(x, y), size, size);
        }
        const dot = (x, y, colour, radius = size * .42) => {
            const [px, py] = at(x, y);
            ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(px + size / 2, py + size / 2, radius, 0, Math.PI * 2); ctx.fill();
        };
        for (const marker of dungeon.markers) {
            const cell = cellOf(layout, marker.x, marker.z);
            if (seen(cell.x, cell.y)) dot(cell.x, cell.y, marker.kind === 'down' ? '#ffb23e' : '#7fd0ff', size * .6);
        }
        for (const chest of dungeon.chests) {
            if (!chest.opened && seen(chest.cell.x, chest.cell.y)) dot(chest.cell.x, chest.cell.y, chest.boss ? '#ffb23e' : '#e9d37a');
        }
        for (const animal of this.game.animalSystem.animals) {
            if (!animal.dungeon || !animal.mesh) continue;
            const spot = animal.mesh.position;
            if (Math.hypot(spot.x - position.x, spot.z - position.z) > 26 || !lineOfSight(layout, position.x, position.z, spot.x, spot.z)) continue;
            const cell = cellOf(layout, spot.x, spot.z);
            dot(cell.x, cell.y, '#ff6a55', CREATURES[animal.kind]?.boss ? size * .8 : size * .38);
        }
        // The player: an arrow pointing the way they face.
        const here = cellOf(layout, position.x, position.z), [px, py] = at(here.x, here.y);
        ctx.save();
        ctx.translate(px + size / 2, py + size / 2);
        ctx.rotate(this.game.playerSystem.camera.rotation.y);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.moveTo(0, -size * .95); ctx.lineTo(size * .62, size * .7); ctx.lineTo(-size * .62, size * .7); ctx.closePath(); ctx.fill();
        ctx.restore();
    }
    updateDungeonUI() {
        const dungeon = this.game.dungeonSystem;
        if (!dungeon) return;
        const underground = dungeon.active;
        this.$('minimap').hidden = !underground;
        this.$('exploration-card').hidden = underground;
        const legend = underground ? null : this.game.legends?.active;
        const boss = underground ? dungeon.boss : legend?.animal || null, bar = this.$('boss-bar');
        bar.hidden = legend ? false : !(boss && boss.alerted !== undefined && (boss.alert > 0 || boss.health < boss.maxHealth));
        if (!bar.hidden) {
            bar.querySelector('small').textContent = legend ? legend.legend.name.toUpperCase() : 'STONE WARDEN' + (boss.enraged ? ' · ENRAGED' : '');
            bar.querySelector('progress').value = Math.max(0, boss.health / boss.maxHealth * 100);
        }
        if (underground) {
            this.$('weather-status').textContent = `${dungeon.site.name} · Floor ${dungeon.floor} / ${FLOORS}`;
            this.drawMinimap();
            return;
        }
        const site = dungeon.nearest, line = this.$('dungeon-next');
        if (!site) { line.textContent = ''; return; }
        const player = this.game.playerSystem.camera.position;
        line.textContent = `${dungeon.found.has(site.id) ? site.name : 'Something underground'} · ${Math.round(site.distance)}m ${compass(Math.atan2(site.x - player.x, site.z - player.z))}${site.cleared ? ' · cleared' : ''}`;
    }
    updateInventoryUI() {
        const inv = this.game.inventorySystem.inventory;
        const carried = Object.entries(inv).filter(([, count]) => count > 0);
        this.$('inventory').innerHTML = carried.length
            ? carried.map(([name, count]) => `<div><small>${ITEMS[name]}</small><strong>${count}</strong></div>`).join('')
            : '<p class="empty-pack">Your pack is empty · Hold click on trees, rocks and plants to gather</p>';
        this.updateObjectiveUI();
        this.$('recipes').querySelectorAll('button').forEach(button => {
            const reason = this.game.inventorySystem.blockedReason(button.dataset.recipe);
            button.disabled = Boolean(reason);
            button.title = reason;
        });
        this.$('build-options').querySelectorAll('button').forEach(button => {
            button.disabled = !this.game.buildSystem.canAfford(button.dataset.building);
        });
        this.updateExperienceUI();
    }
    updateObjectiveUI() {
        const progression = this.game.progression;
        if (!progression || !this.game.buildSystem) return;
        const quest = progression.current();
        const number = String(Math.min(progression.completed.size + 1, 99)).padStart(2, '0');
        this.$('objective-kicker').textContent = quest ? `FIELD NOTES / ${number}` : 'FIELD NOTES / COMPLETE';
        this.$('objective-title').textContent = quest ? quest.title : 'The wilds are yours';
        this.$('objective-text').textContent = quest ? quest.text
            : 'Every note is written. Keep exploring: the trails and landmarks go on without end.';
        this.$('objective-progress').textContent = quest ? `${quest.progress(this.game)} · +${quest.xp} XP`
            : `Day ${this.game.dayCount} · ${this.game.explorationSystem.discovered.size} landmarks found`;
    }
    updateExperienceUI() {
        const c = this.game.combatSystem;
        this.$('level').textContent = `Level ${c.level} · ${c.experience} / ${c.expToNextLevel} XP`;
        this.$('experience').value = c.experience / c.expToNextLevel * 100;
        this.updatePerkButton();
    }
    updateExplorationUI(nearest, discoveredCount) {
        const title = this.$('location-next');
        const progress = this.$('location-progress');
        if (nearest) {
            const player = this.game.playerSystem.camera.position;
            const dx = nearest.x - player.x, dz = nearest.z - player.z;
            title.textContent = nearest.name + ' · ' + Math.round(nearest.distance) + 'm ' + compass(Math.atan2(dx, dz));
        } else {
            title.textContent = 'Scout farther along the trails';
        }
        progress.textContent = discoveredCount ? `${discoveredCount} place${discoveredCount === 1 ? '' : 's'} found` : 'Walk up to a place to search it';
    }
    updateWeatherUI(label) {
        this.$('weather-status').textContent = label;
    }
    updateSurvivalUI() {
        const survival = this.game.survivalSystem;
        if (!survival) return;
        for(const [id,level] of [['hunger',survival.hunger],['thirst',survival.thirst],['cold',survival.cold]]) {
            this.$(id).value=level;
            this.$(id+'-value').textContent=Math.ceil(level)+'%';
        }
        if (this.game.inventorySystem.inventory.waterskin > 0)
            this.$('thirst-value').textContent = `${'●'.repeat(survival.water)}${'○'.repeat(WATERSKIN_CAPACITY - survival.water)} ${Math.ceil(survival.thirst)}%`;
        const root = this.$('hud');
        root.classList.toggle('need-hunger', survival.hunger < 20);
        root.classList.toggle('need-thirst', survival.thirst < 20);
        root.classList.toggle('need-cold', survival.cold > 70);
    }
    updateHealthUI(health, max) {
        this.$('health').value = health / max * 100;
        this.$('health-value').textContent = `${Math.ceil(health)} / ${max}`;
        this.$('hud').classList.toggle('low-health', health > 0 && health / max < .3);
    }
    updateOxygenUI(oxygen, max) {
        this.$('oxygen-row').hidden = oxygen >= max - .5;
        this.$('oxygen').value = oxygen / max * 100;
        this.$('oxygen-value').textContent = `${Math.ceil(oxygen)}%`;
    }
    showNotification(message) {
        this.$('toast').textContent = message;
        this.$('toast').classList.add('visible');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.$('toast').classList.remove('visible'), 2600);
    }
    // Swing pips under the reticle while a node is being worked.
    showGatherProgress(hits, needed, resource) {
        this.gatherHint = {
            text: `${resource.verb[0].toUpperCase()}${resource.verb.slice(1)} ${resource.label}  ${'●'.repeat(hits)}${'○'.repeat(Math.max(0, needed - hits))}`,
            until: performance.now() + 1400
        };
        this.$('target-hint').textContent = this.gatherHint.text;
    }
    showLevelUpMessage() { this.showNotification(`Level ${this.game.combatSystem.level}! Health restored and attack increased.`); }
    // `raw` shows `day` as the heading itself (a dungeon name, a victory).
    showDayBanner(day, message, slept = false, raw = false) {
        const banner = this.$('day-banner');
        banner.querySelector('strong').textContent = raw ? day : `Day ${day}`;
        banner.querySelector('span').textContent = message;
        banner.classList.add('visible');
        clearTimeout(this.bannerTimer);
        this.bannerTimer = setTimeout(() => banner.classList.remove('visible'), 4200);
        if (slept) {
            // Cut to black, then let the morning fade in.
            const fade = this.$('fade');
            fade.classList.add('instant', 'on');
            void fade.offsetWidth;
            fade.classList.remove('instant');
            setTimeout(() => fade.classList.remove('on'), 350);
        }
    }
    showDeath(cause) {
        this.$('death-kicker').textContent = `EXPEDITION LOG · DAY ${this.game.dayCount}`;
        this.$('death-cause').textContent = `You were lost to ${cause}.`;
        this.$('death-screen').hidden = false;
        this.$('target-hint').textContent = '';
    }
    hideDeath() { this.$('death-screen').hidden = true; }
    targetHint(p) {
        const game = this.game, inv = game.inventorySystem.inventory;
        if (p.isDead) return '';
        const placing = game.buildSystem.placing;
        if (placing) return placing.blocked
            ? `${placing.blocked} · Esc to cancel`
            : `Click to place ${BUILDINGS[placing.type].name.toLowerCase()} · R to rotate · Esc to cancel`;
        if (this.gatherHint && performance.now() < this.gatherHint.until) return this.gatherHint.text;
        const obj = game.inventorySystem.findTarget();
        if (obj) {
            const resource = RESOURCES[obj.type];
            const needed = hitsNeeded(obj.type, inv);
            if (!Number.isFinite(needed)) return `Tool required to mine ${resource.label}`;
            const left = needed - (obj.hits || 0);
            return `Hold click to ${resource.verb} ${resource.label}${left > 1 ? ` · ${left} swings` : ''}`;
        }
        // A creature under the reticle: its name and how much fight is left in it.
        const creature = game.combatSystem.targeted();
        if (creature) {
            const def = CREATURES[creature.kind];
            return `${def?.label || creature.kind} · ${Math.max(0, Math.ceil(creature.health))} / ${creature.maxHealth || Math.ceil(creature.health)}`;
        }
        const special = game.dungeonSystem?.interaction();
        if (special) return special.label;
        const nearby = game.companion?.interaction() || game.storage?.interaction() || game.pois?.interaction();
        if (nearby) return nearby.label;
        // The homestead: a line in the water, or a garden bed underfoot.
        const fishing = game.fishing?.hint();
        if (fishing && game.fishing.busy()) return fishing;
        const garden = game.gardens?.interaction();
        if (garden) return garden.label;
        if (fishing) return fishing;
        if (game.dungeonSystem?.active) return inv.torch > 0 && !game.effects?.torchLit ? 'Press F to light your torch' : '';
        if (p.isFlying) return 'Flying · Space to land / Ctrl to descend';
        if (p.isUnderwater) return 'Underwater · Space to surface';
        if (p.isSwimming) return 'Swimming · Ctrl to dive';
        const survival = game.survivalSystem;
        const sleep = survival.sleepStatus();
        if (sleep.ok) return 'Press E to rest until dawn';
        if (survival.nearWater() && (survival.thirst < 95 || (survival.hasWaterskin() && survival.water < WATERSKIN_CAPACITY)))
            return survival.hasWaterskin() ? 'Press E to drink and fill the waterskin' : 'Press E to drink from the shoreline';
        if (survival.thirst < 45 && survival.hasWaterskin() && survival.water > 0) return 'Press E to drink from the waterskin';
        if (sleep.near && sleep.reason && survival.isNight()) return sleep.reason;
        if (survival.isNight() && inv.torch > 0 && !game.effects?.torchLit) return 'Press F to light your torch';
        return '';
    }
    update() {
        const now = performance.now();
        if (now - this.lastRefresh < 100) return; // Ten HUD refreshes a second is plenty.
        this.lastRefresh = now;
        const p = this.game.playerSystem;
        this.updateHealthUI(p.health, p.maxHealth);
        this.updateOxygenUI(p.oxygenLevel, p.maxOxygen);
        this.updateSurvivalUI();
        if (this.game.weatherSystem) this.updateWeatherUI(this.game.weatherSystem.label || 'Clear skies');
        this.updateDungeonUI();
        // Shrine boons and how long they have left.
        const boons = this.game.buffs?.list() || [];
        const chips = boons.map(boon => `${boon.label} ${Math.floor(boon.left / 60)}:${String(Math.floor(boon.left % 60)).padStart(2, '0')}`)
            .concat(p.poisonLeft > 0 ? [`Poisoned 0:${String(Math.ceil(p.poisonLeft)).padStart(2, '0')}`] : []).join(' · ');
        // Where you are, and the way to somewhere you have not been.
        const regions = this.game.regions;
        if (regions) {
            const guide = regions.guide, lair = this.game.legends?.nearest(p.camera.position);
            const place = this.game.dungeonSystem?.active ? '' : regions.def.name
                + (guide ? ` · ${guide.name} lies ${Math.round(guide.distance)}m ${compass(guide.bearing)}` : '')
                + (lair && lair.distance < 600 ? ` · ${lair.legend.name}'s lair ${Math.round(lair.distance)}m ${compass(lair.bearing)}` : '');
            if (this.$('region-line').textContent !== place) this.$('region-line').textContent = place;
        }
        if (this.$('buffs').textContent !== chips) this.$('buffs').textContent = chips;
        // The dog: how it is, and a tap (or T) to tell it to stay or come.
        const dog = this.game.companion?.status() || '', dogButton = this.$('dog-button');
        if (dogButton.hidden !== !dog) dogButton.hidden = !dog;
        if (dog && dogButton.textContent !== dog) dogButton.textContent = dog;
        const season = this.game.seasons ? this.game.seasons.def.name.toUpperCase() + ' · ' : '';
        this.$('world-clock').textContent = `${season}DAY ${this.game.dayCount} · ${clockTime(this.game.dayTime, this.game.dayLength)}`;
        if (this.game.paused) return;
        const facing = compass(p.camera.rotation.y);
        if (this.$('compass-facing').textContent !== facing) this.$('compass-facing').textContent = facing;
        let hint = this.targetHint(p);
        if (this.game.touchControls?.enabled) hint = hint
            .replace('Hold click', 'Hold HIT').replace('Click to place', 'HIT to place')
            .replace('Press E', 'Tap USE').replace('Press F', 'Tap TORCH')
            .replace('Click to cast', 'Tap HIT to cast').replace('Click now', 'Tap HIT now').replace('Click to reel', 'HIT to reel')
            .replace(' · R to rotate · Esc to cancel', ' · SKILL cancels').replace(' · Esc to cancel', ' · SKILL cancels')
            .replace('Space to land / Ctrl to descend', 'JUMP to land / DOWN to descend')
            .replace('Space to surface', 'JUMP to surface').replace('Ctrl to dive', 'DOWN to dive');
        this.$('target-hint').textContent = hint;
        this.$('hud').classList.toggle('placing', Boolean(this.game.buildSystem.placing));
        document.body.classList.toggle('underwater', Boolean(p.isUnderwater));
    }
}
