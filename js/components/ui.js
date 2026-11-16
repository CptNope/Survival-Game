import { ITEMS, RESOURCES, RECIPES, RECIPE_GROUPS, recipeDescription, hitsNeeded } from '../resources.js';
import { BUILDINGS } from './building.js';
import { STAT_LABELS } from './progression.js';
import { clockTime } from './sky.js';
import { WATERSKIN_CAPACITY } from './survival.js';

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
            <header class="hud-top"><div><small>THE WILDS</small><strong>Survival expedition</strong></div><div id="world-clock"></div><div id="weather-status">Clear skies</div><div id="save-status" role="status">Autosave · Every 30s</div><button id="menu-button">Esc · Pause</button></header>
            <aside class="objective"><small id="objective-kicker">FIELD NOTES / 01</small><h2 id="objective-title">Make your first tool</h2><p id="objective-text"></p><span id="objective-progress"></span></aside>
            <div class="exploration-card" id="exploration-card" aria-live="off"><small>FIELD COMPASS / <span id="compass-facing">N</span></small><strong id="location-next">Finding the trail…</strong><span id="location-progress">0 locations discovered</span></div>
            <div id="crosshair">+</div><div id="target-hint"></div>
            <div id="toast" role="status" aria-live="polite"></div>
            <div id="day-banner" aria-live="polite"><strong></strong><span></span></div>
            <footer class="hud-bottom"><section class="vitals"><small id="level"></small><label>Health <span id="health-value"></span></label><progress id="health" max="100"></progress><div id="oxygen-row" hidden><label>Oxygen <span id="oxygen-value"></span></label><progress id="oxygen" max="100"></progress></div><label>Hunger <span id="hunger-value"></span></label><progress id="hunger" max="100"></progress><label>Thirst <span id="thirst-value"></span></label><progress id="thirst" max="100"></progress><label>Cold <span id="cold-value"></span></label><progress id="cold" max="100"></progress><progress id="experience" max="100"></progress></section><section id="inventory" class="inventory"></section><button id="craft-button">C · Craft</button><button id="building-button">B · Build</button><button id="inventory-toggle" type="button" aria-expanded="false" aria-controls="inventory">Pack</button></footer>
            <div id="fade" aria-hidden="true"></div>
            <div id="death-screen" hidden role="alert"><div><small id="death-kicker"></small><h1>The wilds claimed you.</h1><p id="death-cause"></p><p>Your supplies lie where you fell. Returning to the clearing…</p></div></div>
            <div id="modal" class="modal"><section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><small id="panel-kicker">WELCOME TO THE WILDS</small><h1 id="panel-title">Leave a little<br>less to chance.</h1><p id="panel-copy">Explore the wilderness, gather supplies, and craft the tools to keep going.</p><div id="recipes"></div><div id="build-options"></div><div id="controls"></div>
                <div id="settings"><label for="set-volume">Sound</label><input id="set-volume" type="range" min="0" max="100" step="5"><button id="set-mute" type="button">Mute</button><label for="set-sensitivity">Look speed</label><input id="set-sensitivity" type="range" min="30" max="250" step="10"><span id="sensitivity-value"></span></div>
                <dl id="stats"></dl>
                <button id="save-now">Save expedition (P)</button><button id="new-game" type="button">Start a new expedition</button><button id="resume" class="primary">Enter the wilds →</button></section></div>`;
        document.body.append(root);
        this.$ = id => document.getElementById(id);
        this.$('menu-button').onclick = () => this.toggleMenu();
        this.$('craft-button').onclick = () => this.toggleCrafting();
        this.$('building-button').onclick = () => this.toggleBuilding();
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
        const build = this.panel === 'build', craft = this.panel === 'craft', menu = !build && !craft;
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
                ? '<p>Use the left stick to move, and drag the open scene to look around.</p><p>Hold HIT to gather or attack · JUMP flies on double tap · RUN sprints.</p><p>USE drinks at lakes and rests in a shelter at night · TORCH lights the dark.</p><p>Tap Craft, Build, or Pack to manage supplies. Progress saves automatically.</p>'
                : '<p><kbd>W A S D</kbd> Move · <kbd>Shift</kbd> Sprint · Hold click to gather / attack</p><p><kbd>Space</kbd> Jump · Double tap to fly · <kbd>Ctrl</kbd> Descend or dive</p><p><kbd>C</kbd> Craft · <kbd>B</kbd> Build · <kbd>R</kbd> Rotate · <kbd>E</kbd> Drink or rest</p><p><kbd>F</kbd> Torch · <kbd>M</kbd> Mute · <kbd>P</kbd> Save · Right click: heavy sweep</p>';
            const progression = this.game.progression;
            if (progression) this.$('stats').innerHTML = `<div><dt>Day</dt><dd>${this.game.dayCount}</dd></div><div><dt>Field notes</dt><dd>${progression.completed.size}</dd></div>` +
                Object.entries(STAT_LABELS).map(([key, label]) => `<div><dt>${label}</dt><dd>${progression.stats[key]}</dd></div>`).join('');
        }
        this.$('save-now').hidden = !menu || title;
        this.$('panel-title').innerHTML = build
            ? 'Make this place<br>your own.'
            : craft ? 'Make something<br>that matters.' : title ? 'Leave a little<br>less to chance.' : 'The wilds can wait.';
        this.$('panel-kicker').textContent = build ? 'BASE CAMP CONSTRUCTION' : craft ? 'FIELD CRAFTING' : title ? 'WELCOME TO THE WILDS' : 'EXPEDITION PAUSED';
        this.$('panel-copy').textContent = build
            ? 'Choose a structure, then aim where it should stand. Click to place it, R to rotate, Esc to cancel.'
            : craft ? 'Better tools gather faster. Food and dressings work straight from your pack.'
            : title ? 'Gather, craft and build before nightfall. The cold, hunger and wolves will not wait.'
            : 'Follow your field notes, keep a fire going, and rest in a shelter at night. Progress saves on this device.';
        const returning = this.game.dayCount > 1 || this.game.progression?.completed.size > 0;
        this.$('resume').textContent = build || craft ? 'Back to the wilds →'
            : title ? (returning ? `Continue expedition · Day ${this.game.dayCount} →` : 'Enter the wilds →') : 'Return to the wilds →';
        if (this.panel) {
            // Focus the way out without scrolling the long crafting list to its end.
            this.$('resume').focus({preventScroll: true});
            this.$('modal').querySelector('.panel').scrollTop = 0;
        }
        const touch = Boolean(this.game.touchControls?.enabled);
        this.$('menu-button').textContent = touch ? 'Pause' : 'Esc · Pause';
        this.$('craft-button').textContent = touch ? 'Craft' : 'C · Craft';
        this.$('building-button').textContent = touch ? 'Build' : 'B · Build';
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
    showDayBanner(day, message, slept = false) {
        const banner = this.$('day-banner');
        banner.querySelector('strong').textContent = `Day ${day}`;
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
