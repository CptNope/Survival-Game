// Field notes: an ordered chain of goals that teaches the survival loop and
// pays out experience, plus the expedition statistics shown when paused.
const has = (game, type) => game.buildSystem?.structures?.some(item => item.type === type) || false;
const inv = game => game.inventorySystem?.inventory || {};

export const QUESTS = Object.freeze([
    {
        id: 'tool', xp: 25, title: 'Make your first tool',
        text: 'Gather wood and stone. Turn wood into planks, then craft a stone tool to work faster.',
        done: g => inv(g).tools > 0 || inv(g).ironTools > 0,
        progress: g => `${inv(g).wood || 0} wood · ${inv(g).stone || 0} stone · ${inv(g).planks || 0} planks`
    },
    {
        id: 'fire', xp: 30, title: 'Light a campfire',
        text: 'Press B and place a campfire. It keeps the cold off and lets you cook.',
        done: g => has(g, 'fire'),
        progress: g => `${Math.min(3, inv(g).wood || 0)}/3 wood · ${Math.min(3, inv(g).stone || 0)}/3 stone`
    },
    {
        id: 'meal', xp: 40, title: 'Cook a hot meal',
        text: 'Hunt a deer or rabbit, roast the meat beside your fire, then eat it.',
        done: g => g.progression.stats.meals > 0,
        progress: g => `${inv(g).rawMeat || 0} raw meat · ${inv(g).cookedMeat || 0} cooked`
    },
    {
        id: 'shelter', xp: 40, title: 'Build a shelter',
        text: 'A lean-to needs 6 wood, 2 planks and 3 fiber. It is somewhere safe to sleep.',
        done: g => has(g, 'shelter') || has(g, 'roof'),
        progress: g => `${inv(g).wood || 0}/6 wood · ${inv(g).planks || 0}/2 planks · ${inv(g).fiber || 0}/3 fiber`
    },
    {
        id: 'night', xp: 50, title: 'Make it to dawn',
        text: 'Wolves hunt after dark. Rest in your shelter (E) or keep close to the fire until sunrise.',
        done: g => g.progression.stats.nights > 0,
        progress: () => 'Survive one night'
    },
    {
        id: 'landmarks', xp: 60, title: 'Scout the trails',
        text: 'Follow the dirt paths out of the clearing. Each landmark holds a cache of supplies.',
        done: g => (g.explorationSystem?.discovered?.size || 0) >= 3,
        progress: g => `${Math.min(3, g.explorationSystem?.discovered?.size || 0)}/3 landmarks discovered`
    },
    {
        id: 'iron', xp: 75, title: 'Forge an iron tool',
        text: 'Mine iron deposits with your stone tool, smelt the ore and craft stronger equipment.',
        done: g => inv(g).ironTools > 0,
        progress: g => `${inv(g).ironOre || 0} ore · ${inv(g).iron || 0}/2 ingots · ${inv(g).fiber || 0}/2 fiber`
    },
    {
        id: 'wolf', xp: 75, title: 'Stand your ground',
        text: 'Craft a spear for its reach and drive off a wolf after nightfall.',
        done: g => g.progression.stats.wolves > 0,
        progress: g => inv(g).spear > 0 ? 'Spear ready · Defeat a wolf' : 'Craft a spear: 2 wood, 1 stone, 1 fiber'
    },
    {
        id: 'cabin', xp: 100, title: 'Raise a cabin',
        text: 'Lay a wooden floor, put up a log wall and cover it with a roof on the same plot.',
        done: g => has(g, 'floor') && has(g, 'wall') && has(g, 'roof'),
        progress: g => ['floor', 'wall', 'roof'].map(type => (has(g, type) ? '✓ ' : '○ ') + type).join(' · ')
    },
    {
        id: 'veteran', xp: 150, title: 'Outlast the wilds',
        text: 'Keep the expedition alive through five full days.',
        done: g => g.dayCount >= 6,
        progress: g => `Day ${Math.min(6, g.dayCount)} of 6`
    }
]);

export const STAT_LABELS = Object.freeze({
    gathered: 'Resources gathered', crafted: 'Items crafted', built: 'Structures built',
    hunted: 'Animals hunted', wolves: 'Wolves defeated', meals: 'Hot meals eaten',
    nights: 'Nights survived', slept: 'Nights slept', deaths: 'Deaths'
});

export class ProgressionSystem {
    constructor(game) {
        this.game = game;
        this.completed = new Set();
        this.stats = Object.fromEntries(Object.keys(STAT_LABELS).map(key => [key, 0]));
    }

    record(stat, amount = 1) {
        if (Object.hasOwn(this.stats, stat)) this.stats[stat] += amount;
        this.check();
    }

    current() {
        return QUESTS.find(quest => !this.completed.has(quest.id)) || null;
    }

    // Completes every goal already satisfied, in order. Returns those finished.
    check() {
        const finished = [];
        for (let guard = 0; guard < QUESTS.length; guard++) {
            const quest = this.current();
            let done = false;
            try { done = Boolean(quest?.done(this.game)); } catch { done = false; }
            if (!done) break;
            this.completed.add(quest.id);
            finished.push(quest);
            this.game.combatSystem?.gainExperience?.(quest.xp);
        }
        if (finished.length) {
            const last = finished[finished.length - 1];
            this.game.uiSystem?.showNotification?.(`Field note complete: ${last.title} · +${finished.reduce((sum, quest) => sum + quest.xp, 0)} XP`);
            this.game.audio?.play('quest');
            this.game.uiSystem?.updateObjectiveUI?.();
        }
        return finished;
    }

    capture() {
        return {completed: [...this.completed], stats: {...this.stats}};
    }

    restore(saved) {
        this.completed = new Set((Array.isArray(saved?.completed) ? saved.completed : [])
            .filter(id => QUESTS.some(quest => quest.id === id)));
        for (const key of Object.keys(this.stats)) {
            const value = saved?.stats?.[key];
            this.stats[key] = Number.isFinite(value) ? Math.max(0, Math.min(1e9, Math.floor(value))) : 0;
        }
    }
}
