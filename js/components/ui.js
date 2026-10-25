import { ITEMS, RESOURCES, RECIPES, recipeDescription } from '../resources.js';
import { BUILDINGS } from './building.js';
export class UISystem {
    constructor(game) {
        this.game = game;
        this.panel = 'menu';
        const root = document.createElement('div');
        root.id = 'hud';
        root.innerHTML = `
            <header class="hud-top"><div><small>THE WILDS</small><strong>Survival expedition</strong></div><div id="world-clock"></div><div id="save-status" role="status">Autosave · Every 30s</div><button id="menu-button">Esc · Pause</button></header>
            <aside class="objective"><small>FIELD NOTES / 01</small><h2>Make your first tool</h2><p>Gather wood and stone. Turn wood into planks, then craft a tool.</p><span id="objective-progress"></span></aside>
            <div class="exploration-card" id="exploration-card" aria-live="off"><small>FIELD COMPASS / UNEXPLORED</small><strong id="location-next">Finding the trail…</strong><span id="location-progress">0 locations discovered</span></div>
            <div id="crosshair">+</div><div id="target-hint"></div>
            <div id="toast" role="status" aria-live="polite"></div>
            <footer class="hud-bottom"><section class="vitals"><small id="level"></small><label>Health <span id="health-value"></span></label><progress id="health" max="100"></progress><label>Oxygen <span id="oxygen-value"></span></label><progress id="oxygen" max="100"></progress><label>Hunger <span id="hunger-value"></span></label><progress id="hunger" max="100"></progress><label>Thirst <span id="thirst-value"></span></label><progress id="thirst" max="100"></progress><label>Cold <span id="cold-value"></span></label><progress id="cold" max="100"></progress><progress id="experience" max="100"></progress></section><section id="inventory" class="inventory"></section><button id="craft-button">C · Craft</button><button id="building-button">B · Build</button></footer>
            <div id="modal" class="modal"><section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><small id="panel-kicker">WELCOME TO THE WILDS</small><h1 id="panel-title">Leave a little<br>less to chance.</h1><p id="panel-copy">Explore the wilderness, gather supplies, and craft the tools to keep going.</p><div id="recipes"></div><div id="build-options"></div><div id="controls"><p><kbd>W A S D</kbd> Move · Hold Shift to sprint · Click to gather / attack</p><p><kbd>Space</kbd> Jump · Double tap to fly · Ctrl to descend</p><p><kbd>C</kbd> Craft · <kbd>B</kbd> Build shelter · <kbd>E</kbd> Drink at water · <kbd>P</kbd> Save</p><p>Right click uses a tool for an area attack</p></div><button id="save-now">Save expedition (P)</button><button id="resume" class="primary">Enter the wilds →</button></section></div>`;
        document.body.append(root);
        this.$ = id => document.getElementById(id);
        this.$('menu-button').onclick = () => this.toggleMenu();
        this.$('craft-button').onclick = () => this.toggleCrafting();
        this.$('building-button').onclick = () => this.toggleBuilding();
        this.$('save-now').onclick = () => {
            if (game.saveSystem.save()) this.showNotification('Expedition saved on this device');
            else this.showNotification('Local saving unavailable');
        };
        this.$('resume').onclick = () => this.closePanel();
        this.$('recipes').innerHTML = Object.entries(RECIPES).map(([id, recipe]) => `<button class="recipe" data-recipe="${id}"><strong>${recipe.name}</strong><span>${recipeDescription(recipe)}</span><b>${recipe.heal ? 'Use +' : 'Craft +'}</b></button>`).join('');
        this.$('recipes').querySelectorAll('button').forEach(button => button.onclick = () => game.inventorySystem.craft(button.dataset.recipe));
        this.$('build-options').innerHTML = Object.entries(BUILDINGS).map(([id, blueprint]) =>
            `<button class="recipe" data-building="${id}"><strong>${blueprint.name}</strong><span>${Object.entries(blueprint.cost).map(([resource,cost])=>`${cost} ${ITEMS[resource]}`).join(' · ')}</span><b>Build →</b></button>`).join('');
        this.$('build-options').querySelectorAll('button').forEach(button => button.onclick = () =>
            game.buildSystem.place(button.dataset.building));
        this.renderPanel();
        this.updateInventoryUI();
    }
    openPanel(panel) { this.panel = panel; this.game.setPaused(true); this.updateInventoryUI(); this.renderPanel(); }
    closePanel() {
        this.panel = null;
        this.game.setPaused(false);
        this.renderPanel();
        this.game.engine.getRenderingCanvas().requestPointerLock?.()?.catch(() => {});
    }
    toggleMenu() { this.panel === 'menu' ? this.closePanel() : this.openPanel('menu'); }
    toggleCrafting() { this.panel === 'craft' ? this.closePanel() : this.openPanel('craft'); }
    toggleBuilding() { this.panel === 'build' ? this.closePanel() : this.openPanel('build'); }
    setSaveStatus(message) { this.$('save-status').textContent = message; }
    renderPanel() {
        const build = this.panel === 'build', craft = this.panel === 'craft';
        this.$('modal').hidden = !this.panel;
        this.$('recipes').hidden = !craft;
        this.$('build-options').hidden = !build;
        this.$('controls').hidden = craft || build;
        this.$('save-now').hidden = craft || build;
        this.$('panel-title').innerHTML = build
            ? 'Make this place<br>your own.'
            : craft ? 'Make something<br>that matters.' : 'The wilds can wait.';
        this.$('panel-kicker').textContent = build ? 'BASE CAMP CONSTRUCTION' : craft ? 'FIELD CRAFTING' : 'EXPEDITION PAUSED';
        this.$('panel-copy').textContent = build
            ? 'Face the site you want to build, then choose a structure. Each shelter protects against exposure at night. A campfire also offers warmth.'
            : craft ? 'Craft healing supplies and equipment. Berries refill hunger even at full health.'
            : 'Drink at shorelines (E), gather food, make a shelter, and explore landmarks. Progress saves locally every 30 seconds.';
        this.$('resume').textContent = 'Return to the wilds →';
        if (this.panel) this.$('resume').focus();
    }
    updateInventoryUI() {
        const inv = this.game.inventorySystem.inventory;
        this.$('inventory').innerHTML = Object.entries(inv).map(([name, count], i) => `<div><small>${String(i + 1).padStart(2, '0')} / ${ITEMS[name]}</small><strong>${count}</strong></div>`).join('');
        const objective = this.$('hud').querySelector('.objective');
        const title = objective.querySelector('h2');
        const description = objective.querySelector('p');
        if (this.game.buildSystem.structures.length && inv.ironTools) {
            title.textContent = 'Survive the next night';
            description.textContent = 'Track deer, explore the hills, and gather herbs for emergency healing.';
            this.$('objective-progress').textContent = '✓ Iron tool crafted · Hunt, explore, and level up';
        } else if (inv.tools && !this.game.buildSystem.structures.some(s=>s.type === 'shelter')) {
            title.textContent = 'Build your first shelter';
            description.textContent = 'Gather wood and fiber, craft two planks, then press B to construct a lean-to.';
            this.$('objective-progress').textContent = `${inv.wood} wood · ${inv.planks} planks · ${inv.fiber} fiber`;
        } else if (inv.tools) {
            title.textContent = 'Forge an iron tool';
            description.textContent = 'Mine deposits, gather fiber and wood, then smelt iron and craft stronger equipment.';
            this.$('objective-progress').textContent = `${inv.ironOre} ore · ${inv.iron} ingots · ${inv.fiber} fiber`;
        } else {
            title.textContent = 'Make your first tool';
            description.textContent = 'Gather wood and stone. Turn wood into planks, then craft a tool.';
            this.$('objective-progress').textContent = `${inv.wood} wood · ${inv.stone} stone · ${inv.planks} planks`;
        }
        this.$('recipes').querySelectorAll('button').forEach(button => {
            button.disabled = !this.game.inventorySystem.canCraft(button.dataset.recipe);
        });
        this.$('build-options').querySelectorAll('button').forEach(button => {
            button.disabled = !this.game.buildSystem.canAfford(button.dataset.building);
        });
        this.updateExperienceUI();
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
            const bearing = Math.atan2(dx, dz);
            const directions = ['N','NE','E','SE','S','SW','W','NW'];
            const direction = directions[(Math.round(bearing / (Math.PI / 4)) + 8) % 8];
            title.textContent = nearest.name + ' · ' + Math.round(nearest.distance) + 'm ' + direction;
        } else {
            title.textContent = 'Scout farther along the trails';
        }
        progress.textContent = discoveredCount + ' locations discovered · Get within 8m to salvage supplies';
    }
    updateSurvivalUI() {
        const survival = this.game.survivalSystem;
        if (!survival) return;
        for(const [id,level] of [['hunger',survival.hunger],['thirst',survival.thirst],['cold',survival.cold]]) {
            this.$(id).value=level;
            this.$(id+'-value').textContent=Math.ceil(level)+'%';
        }
    }
    updateHealthUI(health, max) { this.$('health').value = health / max * 100; this.$('health-value').textContent = `${Math.ceil(health)} / ${max}`; }
    updateOxygenUI(oxygen, max) { this.$('oxygen').value = oxygen / max * 100; this.$('oxygen-value').textContent = `${Math.ceil(oxygen)}%`; }
    showNotification(message) {
        this.$('toast').textContent = message;
        this.$('toast').classList.add('visible');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.$('toast').classList.remove('visible'), 2400);
    }
    showLevelUpMessage() { this.showNotification(`Level ${this.game.combatSystem.level}! Health restored and attack increased.`); }
    update() {
        const p = this.game.playerSystem;
        this.updateHealthUI(p.health, p.maxHealth);
        this.updateOxygenUI(p.oxygenLevel, p.maxOxygen);
        this.updateSurvivalUI();
        const phase = this.game.dayTime / this.game.dayLength;
        this.$('world-clock').textContent = `DAY ${this.game.dayCount} / ${phase < .5 ? 'DAYLIGHT' : 'NIGHTFALL'}`;
        if (this.game.paused) return;
        const hit = this.game.pickTarget();
        const obj = hit?.hit && this.game.inventorySystem.harvestableObjects.find(o => o.mesh === hit.pickedMesh || o.relatedMeshes?.includes(hit.pickedMesh));
        this.$('target-hint').textContent = p.isDead ? 'You fell. Returning to the clearing…' : obj ? `${RESOURCES[obj.type]?.requiresTool && !this.game.inventorySystem.inventory.tools && !this.game.inventorySystem.inventory.ironTools ? 'Tool required to mine' : 'Click to gather'} ${RESOURCES[obj.type]?.label || obj.type}` : p.isFlying ? 'Flying · Space to land / Ctrl to descend' : this.game.survivalSystem?.nearWater() && this.game.survivalSystem.thirst < 95 ? 'Press E to drink from the shoreline' : 'Explore · Gather · Craft · Build';
    }
}
