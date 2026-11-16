import { ITEMS, RESOURCES, RECIPES, RECIPE_GROUPS, recipeDescription, hitsNeeded } from '../resources.js';
import { BUILDINGS } from './building.js';
import { STAT_LABELS } from './progression.js';
import { clockTime } from './sky.js';
import { WATERSKIN_CAPACITY } from './survival.js';
import { RARITIES, SLOTS, STATS, rarityIndex, describeStat, salvageValue } from '../gear.js';
import { BAG_SIZE } from './equipment.js';
import { GRID, FLOORS, cellOf, lineOfSight } from '../dungeon.js';
import { CREATURES } from '../creatures.js';

const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const rarityOf = item => RARITIES[rarityIndex(item.rarity)];

const BUILD_NOTES = {
    shelter: 'Shelter from the cold · a place to sleep', fire: 'Warmth · cooking · light',
    floor: 'Cabin foundation', wall: 'Blocks wolves and wind', roof: 'Cover from rain · a place to sleep'
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
        root.innerHTML = `
            <div id="hurt-vignette" aria-hidden="true"></div>
            <div id="effects-layer" aria-hidden="true"></div>
            <header class="hud-top"><div><small>THE WILDS</small><strong>Survival expedition</strong></div><div id="world-clock"></div><div id="weather-status">Clear skies</div><div id="save-status" role="status">Autosave · Every 30s</div><div class="hud-buttons"><button id="view-button" type="button" aria-label="Change camera view">V · View</button><button id="menu-button">Esc · Pause</button></div></header>
            <div id="buffs" aria-live="off"></div>
            <aside class="objective"><small id="objective-kicker">FIELD NOTES / 01</small><h2 id="objective-title">Make your first tool</h2><p id="objective-text"></p><span id="objective-progress"></span></aside>
            <div class="exploration-card" id="exploration-card" aria-live="off"><small>FIELD COMPASS / <span id="compass-facing">N</span></small><strong id="location-next">Finding the trail…</strong><span id="location-progress">0 locations discovered</span><span id="dungeon-next"></span></div>
            <canvas id="minimap" width="186" height="186" hidden aria-label="Dungeon map"></canvas>
            <div id="boss-bar" hidden><small></small><progress max="100" value="100"></progress></div>
            <div id="crosshair">+</div><div id="target-hint"></div>
            <div id="toast" role="status" aria-live="polite"></div>
            <div id="day-banner" aria-live="polite"><strong></strong><span></span></div>
            <footer class="hud-bottom"><section class="vitals"><small id="level"></small><label>Health <span id="health-value"></span></label><progress id="health" max="100"></progress><div id="oxygen-row" hidden><label>Oxygen <span id="oxygen-value"></span></label><progress id="oxygen" max="100"></progress></div><label>Hunger <span id="hunger-value"></span></label><progress id="hunger" max="100"></progress><label>Thirst <span id="thirst-value"></span></label><progress id="thirst" max="100"></progress><label>Cold <span id="cold-value"></span></label><progress id="cold" max="100"></progress><progress id="experience" max="100"></progress></section><section id="inventory" class="inventory"></section><button id="craft-button">C · Craft</button><button id="building-button">B · Build</button><button id="gear-button">G · Gear</button><button id="inventory-toggle" type="button" aria-expanded="false" aria-controls="inventory">Pack</button></footer>
            <div id="fade" aria-hidden="true"></div>
            <div id="death-screen" hidden role="alert"><div><small id="death-kicker"></small><h1>The wilds claimed you.</h1><p id="death-cause"></p><p>Your supplies lie where you fell. Returning to the clearing…</p></div></div>
            <div id="modal" class="modal"><section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><small id="panel-kicker">WELCOME TO THE WILDS</small><h1 id="panel-title">Leave a little<br>less to chance.</h1><p id="panel-copy">Explore the wilderness, gather supplies, and craft the tools to keep going.</p><div id="recipes"></div><div id="build-options"></div><div id="gear-panel"></div><div id="controls"></div>
                <div id="settings"><label for="set-volume">Sound</label><input id="set-volume" type="range" min="0" max="100" step="5"><button id="set-mute" type="button">Mute</button><label for="set-sensitivity">Look speed</label><input id="set-sensitivity" type="range" min="30" max="250" step="10"><span id="sensitivity-value"></span></div>
                <dl id="stats"></dl>
                <button id="save-now">Save expedition (P)</button><button id="new-game" type="button">Start a new expedition</button><button id="resume" class="primary">Enter the wilds →</button></section></div>`;
        document.body.append(root);
        this.$ = id => document.getElementById(id);
        this.$('menu-button').onclick = () => this.toggleMenu();
        this.$('craft-button').onclick = () => this.toggleCrafting();
        this.$('building-button').onclick = () => this.toggleBuilding();
        this.$('gear-button').onclick = () => this.toggleGear();
        this.$('view-button').onclick = () => { if (!game.paused) game.viewSystem?.cycle(); };
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
            this.$('inventory-toggle').textContent = hidden ? 'Pack' : 'Close pack';
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
    setSaveStatus(message) { this.$('save-status').textContent = message; }
    syncSettings() {
        const settings = this.game.settings;
        if (!settings) return;
        this.$('set-volume').value = String(Math.round((settings.muted ? 0 : settings.volume) * 100));
        this.$('set-sensitivity').value = String(Math.round(settings.sensitivity * 100));
        this.$('sensitivity-value').textContent = settings.sensitivity.toFixed(1) + '×';
        this.$('set-mute').textContent = settings.muted ? 'Unmute' : 'Mute';
        this.$('set-mute').setAttribute('aria-pressed', String(settings.muted));
    }
    renderPanel() {
        const build = this.panel === 'build', craft = this.panel === 'craft', gear = this.panel === 'gear';
        const menu = !build && !craft && !gear;
        this.$('gear-panel').hidden = !gear;
        if (gear) this.updateGearUI();
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
            this.$('controls').innerHTML = this.game.touchControls?.enabled
                ? '<p>Use the left stick to move, and drag the open scene to look around.</p><p>Hold HIT to gather or attack · JUMP flies on double tap · RUN sprints.</p><p>USE drinks, rests in a shelter at night, opens chests and takes doorways and stairs · TORCH lights the dark.</p><p>VIEW switches between first-person, third-person and overhead · DODGE sidesteps a blow · HEAL uses your best remedy.</p><p>Tap Craft, Build, Gear, or Pack to manage supplies. Progress saves automatically.</p>'
                : '<p><kbd>W A S D</kbd> Move · <kbd>Shift</kbd> Sprint · Hold click to gather / attack</p><p><kbd>Space</kbd> Jump · Double tap to fly · <kbd>Ctrl</kbd> Descend or dive</p><p><kbd>C</kbd> Craft · <kbd>B</kbd> Build · <kbd>G</kbd> Gear · <kbd>R</kbd> Rotate</p><p><kbd>E</kbd> Drink, rest, open chests, use doorways and stairs</p><p><kbd>V</kbd> First-person, third-person or overhead view · Mouse wheel zooms</p><p><kbd>Q</kbd> Dodge · <kbd>H</kbd> Quick heal · <kbd>F</kbd> Torch · Right click: heavy sweep</p><p><kbd>M</kbd> Mute · <kbd>P</kbd> Save</p>';
            const progression = this.game.progression;
            if (progression) this.$('stats').innerHTML = `<div><dt>Day</dt><dd>${this.game.dayCount}</dd></div><div><dt>Field notes</dt><dd>${progression.completed.size}</dd></div>` +
                Object.entries(STAT_LABELS).map(([key, label]) => `<div><dt>${label}</dt><dd>${progression.stats[key]}</dd></div>`).join('');
        }
        this.$('save-now').hidden = !menu || title;
        this.$('panel-title').innerHTML = gear ? 'What the dark<br>gave up.' : build
            ? 'Make this place<br>your own.'
            : craft ? 'Make something<br>that matters.' : title ? 'Leave a little<br>less to chance.' : 'The wilds can wait.';
        this.$('panel-kicker').textContent = gear ? 'GEAR AND LOOT' : build ? 'BASE CAMP CONSTRUCTION' : craft ? 'FIELD CRAFTING' : title ? 'WELCOME TO THE WILDS' : 'EXPEDITION PAUSED';
        this.$('panel-copy').textContent = gear
            ? 'Gear is graded by the bonuses it rolled, from Common to Legendary. You keep it when you fall.'
            : build
            ? 'Choose a structure, then aim where it should stand. Click to place it, R to rotate, Esc to cancel.'
            : craft ? 'Better tools gather faster. Food and dressings work straight from your pack.'
            : title ? 'Gather, craft and build before nightfall. The cold, hunger and wolves will not wait.'
            : 'Follow your field notes, keep a fire going, and rest in a shelter at night. Progress saves on this device.';
        const returning = this.game.dayCount > 1 || this.game.progression?.completed.size > 0;
        this.$('resume').textContent = build || craft || gear ? 'Back to the wilds →'
            : title ? (returning ? `Continue expedition · Day ${this.game.dayCount} →` : 'Enter the wilds →') : 'Return to the wilds →';
        if (this.panel) {
            // Focus the way out without scrolling the long crafting list to its end.
            this.$('resume').focus({preventScroll: true});
            this.$('modal').querySelector('.panel').scrollTop = 0;
        }
        const touch = Boolean(this.game.touchControls?.enabled);
        this.$('menu-button').textContent = touch ? 'Pause' : 'Esc · Pause';
        this.$('view-button').textContent = touch ? 'View' : 'V · View';
        this.$('craft-button').textContent = touch ? 'Craft' : 'C · Craft';
        this.$('building-button').textContent = touch ? 'Build' : 'B · Build';
        this.updateGearButton();
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
        const touch = Boolean(this.game.touchControls?.enabled);
        button.textContent = (touch ? 'Gear' : 'G · Gear') + (upgrades ? ` (${upgrades})` : '');
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
        const boss = underground ? dungeon.boss : null, bar = this.$('boss-bar');
        bar.hidden = !(boss && boss.alerted !== undefined && (boss.alert > 0 || boss.health < boss.maxHealth));
        if (!bar.hidden) {
            bar.querySelector('small').textContent = 'STONE WARDEN' + (boss.enraged ? ' · ENRAGED' : '');
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
        this.$('level').textContent = `LEVEL ${c.level} · ${c.experience} / ${c.expToNextLevel} XP`;
        this.$('experience').value = c.experience / c.expToNextLevel * 100;
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
        progress.textContent = discoveredCount + ' locations discovered · Get within 8m to salvage supplies';
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
        if (this.game.weatherSystem) this.updateWeatherUI(
            {clear:'Clear skies',rain:'Rain',storm:'Storm'}[this.game.weatherSystem.type] || 'Clear skies');
        this.updateDungeonUI();
        // Shrine boons and how long they have left.
        const boons = this.game.buffs?.list() || [];
        const chips = boons.map(boon => `${boon.label} ${Math.floor(boon.left / 60)}:${String(Math.floor(boon.left % 60)).padStart(2, '0')}`).join(' · ');
        if (this.$('buffs').textContent !== chips) this.$('buffs').textContent = chips;
        this.$('world-clock').textContent = `DAY ${this.game.dayCount} · ${clockTime(this.game.dayTime, this.game.dayLength)}`;
        if (this.game.paused) return;
        this.$('compass-facing').textContent = 'FACING ' + compass(p.camera.rotation.y);
        let hint = this.targetHint(p);
        if (this.game.touchControls?.enabled) hint = hint
            .replace('Hold click', 'Hold HIT').replace('Click to place', 'HIT to place')
            .replace('Press E', 'Tap USE').replace('Press F', 'Tap TORCH')
            .replace(' · R to rotate · Esc to cancel', ' · SKILL cancels').replace(' · Esc to cancel', ' · SKILL cancels')
            .replace('Space to land / Ctrl to descend', 'JUMP to land / DOWN to descend')
            .replace('Space to surface', 'JUMP to surface').replace('Ctrl to dive', 'DOWN to dive');
        this.$('target-hint').textContent = hint;
        this.$('hud').classList.toggle('placing', Boolean(this.game.buildSystem.placing));
        document.body.classList.toggle('underwater', Boolean(p.isUnderwater));
    }
}
