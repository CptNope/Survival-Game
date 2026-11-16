// Every animal and monster: what it is worth, how hard it hits and how it
// behaves. Wildlife keeps its original behaviour; anything with a `brain` is
// driven by the hostile AI in components/creatures.js.
export const CREATURES = Object.freeze({
    deer: {label: 'Deer', health: 30, xp: 20, loot: {rawMeat: 2}, stat: 'hunted'},
    rabbit: {label: 'Rabbit', health: 12, xp: 10, loot: {rawMeat: 1, fiber: 1}, stat: 'hunted'},
    wolf: {label: 'Wolf', health: 45, xp: 35, loot: {rawMeat: 1}, stat: 'wolves'},

    // Surface threats.
    boar: {label: 'Boar', brain: 'charger', health: 55, xp: 30, loot: {rawMeat: 3}, stat: 'hunted',
        damage: 13, speed: 2.2, charge: 8.5, aggro: 7, reach: 2.2, cooldown: 2.4, windup: .5, radius: .8,
        cause: 'a boar', sound: 'grunt', gear: {chance: .12, luck: 0}},
    bear: {label: 'Bear', brain: 'melee', health: 130, xp: 90, loot: {rawMeat: 4}, stat: 'hunted',
        damage: 22, speed: 3.4, aggro: 13, reach: 3.3, cooldown: 2.1, windup: .6, radius: 1.1,
        cause: 'a bear', sound: 'roar', gear: {chance: 1, luck: .25}},

    // Dungeon dwellers.
    spider: {label: 'Cave spider', brain: 'lunger', health: 18, xp: 8, damage: 6, speed: 4.4, lunge: 11,
        aggro: 15, reach: 1.8, cooldown: 1.2, windup: .22, radius: .55, cause: 'a cave spider', sound: 'hiss',
        stat: 'monsters', gear: {chance: .05, luck: 0}},
    bat: {label: 'Bat', brain: 'flyer', health: 14, xp: 7, damage: 5, speed: 5.2, aggro: 16, reach: 1.6,
        cooldown: 1.5, windup: .12, radius: .4, hover: 1.9, cause: 'a bat', sound: 'squeak',
        stat: 'monsters', gear: {chance: .04, luck: 0}},
    skeleton: {label: 'Skeleton', brain: 'melee', health: 44, xp: 16, damage: 11, speed: 2.9, aggro: 17,
        reach: 2.5, cooldown: 1.7, windup: .45, radius: .6, cause: 'a skeleton', sound: 'rattle',
        stat: 'monsters', gear: {chance: .12, luck: .1}},
    wraith: {label: 'Wraith', brain: 'caster', health: 30, xp: 20, damage: 12, speed: 2.5, aggro: 19,
        reach: 12, keep: 6.5, cooldown: 2.7, windup: .6, radius: .6, hover: .25, cause: 'a wraith', sound: 'wail',
        stat: 'monsters', gear: {chance: .16, luck: .15}},
    warden: {label: 'Stone Warden', brain: 'boss', health: 300, xp: 160, damage: 26, speed: 2.1, aggro: 30,
        reach: 4.3, cooldown: 3.1, windup: .95, radius: 1.4, cause: 'the Stone Warden', sound: 'roar',
        stat: 'bosses', boss: true}
});

// Deeper floors and farther dungeons hit harder and take more killing.
export function scaleFor(tier = 1, floor = 1) {
    const step = (tier - 1) * .3 + (floor - 1) * .18;
    return {health: 1 + step, damage: 1 + step * .7, xp: 1 + step * .6};
}
