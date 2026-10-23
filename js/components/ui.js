export class UISystem {
    constructor(game) {
        this.game = game;
        this.panel = 'menu';
        const root = document.createElement('div');
        root.id = 'hud';
        root.innerHTML = `
            <header class="hud-top"><div><small>THE WILDS</small><strong>Survival expedition</strong></div><div id="world-clock"></div><button id="menu-button">Esc · Pause</button></header>
            <aside class="objective"><small>FIELD NOTES / 01</small><h2>Make your first tool</h2><p>Gather wood and stone. Turn wood into planks, then craft a tool.</p><span id="objective-progress"></span></aside>
            <div id="crosshair">+</div><div id="target-hint"></div>
            <div id="toast" role="status" aria-live="polite"></div>
            <footer class="hud-bottom"><section class="vitals"><small id="level"></small><label>Health <span id="health-value"></span></label><progress id="health" max="100"></progress><label>Oxygen <span id="oxygen-value"></span></label><progress id="oxygen" max="100"></progress><progress id="experience" max="100"></progress></section><section id="inventory" class="inventory"></section><button id="craft-button">C · Field crafting</button></footer>
            <div id="modal" class="modal"><section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><small id="panel-kicker">WELCOME TO THE WILDS</small><h1 id="panel-title">Leave a little<br>less to chance.</h1><p id="panel-copy">Explore the wilderness, gather supplies, and craft the tools to keep going.</p><div id="recipes"></div><div id="controls"><p><kbd>W A S D</kbd> Move · Mouse to look · Click to gather / attack</p><p><kbd>Space</kbd> Jump · Double tap to fly · Ctrl to descend</p><p><kbd>C</kbd> Craft · Right click uses a tool for an area attack</p></div><button id="resume" class="primary">Enter the wilds →</button></section></div>`;
        document.body.append(root);
        this.$ = id => document.getElementById(id);
        this.$('menu-button').onclick = () => this.toggleMenu();
        this.$('craft-button').onclick = () => this.toggleCrafting();
        this.$('resume').onclick = () => this.closePanel();
        this.$('recipes').innerHTML = [
            ['planks', 'Wooden planks', '2 wood → 1 plank'],
            ['tools', 'Stone tool', '1 plank + 2 stone → 1 tool'],
            ['bandage', 'Field dressing', '3 wood → restore 30 health']
        ].map(([id, name, cost]) => `<button class="recipe" data-recipe="${id}"><strong>${name}</strong><span>${cost}</span><b>Craft +</b></button>`).join('');
        this.$('recipes').querySelectorAll('button').forEach(button => button.onclick = () => game.inventorySystem.craft(button.dataset.recipe));
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
    renderPanel() {
        this.$('modal').hidden = !this.panel;
        this.$('recipes').hidden = this.panel !== 'craft';
        this.$('controls').hidden = this.panel === 'craft';
        this.$('panel-title').innerHTML = this.panel === 'craft' ? 'Make something<br>that matters.' : 'The wilds can wait.';
        this.$('panel-kicker').textContent = this.panel === 'craft' ? 'FIELD CRAFTING' : 'EXPEDITION PAUSED';
        this.$('panel-copy').textContent = this.panel === 'craft' ? 'Turn what you find into what you need. The world pauses while you craft.' : 'Gather supplies, explore beyond the clearing, and build your first tool.';
        this.$('resume').textContent = 'Return to the wilds →';
        if (this.panel) this.$('resume').focus();
    }
    updateInventoryUI() {
        const inv = this.game.inventorySystem.inventory;
        this.$('inventory').innerHTML = Object.entries(inv).map(([name, count], i) => `<div><small>0${i + 1} / ${name}</small><strong>${count}</strong></div>`).join('');
        this.$('objective-progress').textContent = inv.tools ? '✓ Tool ready. Explore, hunt, and level up.' : `${inv.wood} wood · ${inv.stone} stone · ${inv.planks} planks`;
        const costs = { planks: { wood: 2 }, tools: { planks: 1, stone: 2 }, bandage: { wood: 3 } };
        this.$('recipes').querySelectorAll('button').forEach(button => {
            button.disabled = Object.entries(costs[button.dataset.recipe]).some(([key, count]) => inv[key] < count) || this.game.playerSystem.isDead || (button.dataset.recipe === 'bandage' && this.game.playerSystem.health >= this.game.playerSystem.maxHealth);
        });
        this.updateExperienceUI();
    }
    updateExperienceUI() {
        const c = this.game.combatSystem;
        this.$('level').textContent = `LEVEL ${c.level} · ${c.experience} / ${c.expToNextLevel} XP`;
        this.$('experience').value = c.experience / c.expToNextLevel * 100;
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
        const phase = this.game.dayTime / this.game.dayLength;
        this.$('world-clock').textContent = `DAY ${this.game.dayCount} / ${phase < .5 ? 'DAYLIGHT' : 'NIGHTFALL'}`;
        if (this.game.paused) return;
        const hit = this.game.pickTarget();
        const obj = hit?.hit && this.game.inventorySystem.harvestableObjects.find(o => o.mesh === hit.pickedMesh || o.relatedMeshes?.includes(hit.pickedMesh));
        this.$('target-hint').textContent = p.isDead ? 'You fell. Returning to the clearing…' : obj ? `Click to gather ${obj.type === 'tree' ? 'wood' : 'stone'}` : p.isFlying ? 'Flying · Space to land / Ctrl to descend' : 'Explore · Gather · Craft';
    }
}
