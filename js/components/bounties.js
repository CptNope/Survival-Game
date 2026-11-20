// The notice boards: which jobs you have taken, how far along each is, and
// paying out when you come back. The rules are in ../bounties.js.
import { BOARD_KINDS, MAX_BOUNTIES, bountyFor, bountyTitle, bountyReward, boardPeriod, nextPosting, quarryName, validJob } from '../bounties.js';
import { USE_RADIUS, poiById, denReady } from '../pois.js';
import { rollGear } from '../gear.js';
import { itemAmount } from '../resources.js';

export class BountySystem {
    constructor(game) {
        this.game = game;
        this.active = new Map();    // board id -> the job taken from it
        this.claimed = new Map();   // board id -> the posting last paid out
    }

    isBoard(poi) { return Boolean(poi) && BOARD_KINDS.includes(poi.kind); }

    // What the board would post today, if you have nothing from it in hand.
    offer(poi) {
        const pois = this.game.pois, day = this.game.dayCount;
        return bountyFor(poi, day, {denOpen: den => denReady(pois?.cleared.get(den.id), day)});
    }

    // How far along a job is.
    progress(job) {
        let have = job.have || 0;
        if (job.kind === 'fetch') have = Math.min(job.need, this.game.inventorySystem.inventory[job.target] || 0);
        else if (job.kind === 'clear') {
            const cleared = this.game.pois?.cleared.get(job.target);
            have = Number.isFinite(cleared) && cleared !== job.since ? 1 : 0;
        }
        return {have, need: job.need, done: have >= job.need};
    }

    title(job) { return bountyTitle(job, job.kind === 'clear' ? poiById(job.target) : null); }

    // Everything the panel needs to show a board: the job, where it stands,
    // and what the button does.
    board(poi) {
        if (!this.isBoard(poi)) return null;
        const taken = this.active.get(poi.id), reward = job => `A piece of gear and ${bountyReward(job).xp} XP`;
        if (taken) {
            const {have, need, done} = this.progress(taken);
            const count = taken.kind === 'clear' ? (done ? 'Done' : 'Not yet done') : `${have} of ${need}`;
            return {state: done ? 'done' : 'active', job: taken, title: this.title(taken), detail: `${count} · ${reward(taken)}`,
                action: done ? 'claim' : null, button: done ? 'Claim' : 'In hand'};
        }
        const job = this.offer(poi);
        if (!job || this.claimed.get(poi.id) === job.period) {
            return {state: 'claimed', job: null, title: 'Nothing posted', detail: `A new notice goes up on day ${nextPosting(this.game.dayCount)}`, action: null, button: ''};
        }
        const full = this.active.size >= MAX_BOUNTIES;
        return {state: full ? 'full' : 'open', job, title: this.title(job), detail: full ? `You have ${MAX_BOUNTIES} jobs in hand · finish one first` : reward(job),
            action: full ? null : 'accept', button: full ? 'Hands full' : 'Take the job'};
    }

    // Is there anything to do at this board right now?
    actionable(poi) { return Boolean(this.board(poi)?.action); }

    // The board the player is standing at, if it is the one named.
    at(id) {
        const poi = this.game.pois?.here(USE_RADIUS + 2);
        return poi && poi.id === id && this.isBoard(poi) ? poi : null;
    }

    accept(id) {
        const game = this.game, poi = this.at(id), board = poi && this.board(poi);
        if (!board || board.action !== 'accept') { game.audio?.play('deny'); return false; }
        const job = {...board.job, have: 0};
        if (job.kind === 'clear') {
            // Remember how the den stood, so clearing it again is what counts.
            job.since = game.pois.cleared.get(job.target) ?? -1;
            // And put it on the map, if it is not there already.
            if (!game.pois.found.has(job.target)) game.pois.sighted.add(job.target);
        }
        this.active.set(id, job);
        game.audio?.play('click');
        game.uiSystem?.showNotification?.(`Bounty taken · ${this.title(job).replace('Wanted: ', '')}`);
        game.saveSystem?.save?.();
        return true;
    }

    claim(id) {
        const game = this.game, poi = this.at(id), job = this.active.get(id);
        if (!poi || !job || !this.progress(job).done) { game.audio?.play('deny'); return false; }
        const inventory = game.inventorySystem.inventory, pay = bountyReward(job);
        if (job.kind === 'fetch') inventory[job.target] -= job.need;
        this.active.delete(id);
        this.claimed.set(id, job.period);
        game.gear?.add?.(rollGear(Math.random, {level: pay.gearLevel, luck: pay.luck + (game.perks?.value?.('luck') || 0)}));
        game.combatSystem?.gainExperience?.(pay.xp);
        game.progression?.record?.('bounties');
        game.audio?.play('levelup');
        game.effects?.refreshHeld?.();
        game.uiSystem?.updateInventoryUI?.();
        game.uiSystem?.showNotification?.(`Bounty paid · a piece of gear and ${pay.xp} XP`);
        game.saveSystem?.save?.();
        return true;
    }

    // Called for everything the player kills.
    onKill(kind) {
        const game = this.game;
        for (const job of this.active.values()) {
            if (job.kind !== 'hunt' || job.target !== kind || job.have >= job.need) continue;
            job.have++;
            const board = poiById(job.board);
            game.uiSystem?.showNotification?.(job.have >= job.need
                ? `Bounty done · claim it at ${board?.name || 'the board'}`
                : `Bounty · ${job.have} of ${job.need} ${quarryName(kind, job.need)}`);
            if (job.have >= job.need) game.audio?.play('discover');
        }
    }

    // One line per job in hand, for the map.
    list() {
        return [...this.active.values()].map(job => {
            const {have, need, done} = this.progress(job), board = poiById(job.board);
            const what = job.kind === 'hunt' ? `${have} of ${need} ${quarryName(job.target, need)}`
                : job.kind === 'fetch' ? `${have} of ${itemAmount(job.target, need)}` : `${poiById(job.target)?.name || 'A den'} to clear`;
            return `${what} · ${done ? 'claim at' : 'for'} ${board?.name || 'a board'}`;
        });
    }

    capture() {
        return {active: [...this.active.values()].slice(0, MAX_BOUNTIES).map(job => ({...job})),
            claimed: Object.fromEntries([...this.claimed].slice(-300))};
    }

    restore(saved) {
        this.active = new Map();
        this.claimed = new Map();
        for (const job of Array.isArray(saved?.active) ? saved.active.slice(0, MAX_BOUNTIES) : []) {
            if (!validJob(job) || !this.isBoard(poiById(job.board))) continue;
            if (job.kind === 'clear' && poiById(job.target)?.kind !== 'den') continue;
            const have = Number.isInteger(job.have) ? Math.max(0, Math.min(job.need, job.have)) : 0;
            const kept = {board: job.board, period: job.period, level: job.level, kind: job.kind, target: job.target, need: job.need, have};
            if (job.kind === 'clear') kept.since = Number.isFinite(job.since) ? job.since : -1;
            this.active.set(job.board, kept);
        }
        for (const [id, period] of Object.entries(saved?.claimed && typeof saved.claimed === 'object' ? saved.claimed : {}).slice(-300)) {
            if (Number.isInteger(period) && period >= 0 && this.isBoard(poiById(id))) this.claimed.set(id, period);
        }
    }
}
