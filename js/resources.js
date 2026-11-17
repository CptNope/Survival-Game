// Shared by gathering, crafting and the HUD so quantities and labels stay in sync.
export const ITEMS = {
    wood: 'Wood', stone: 'Stone', planks: 'Planks', tools: 'Stone tools',
    ironOre: 'Iron ore', iron: 'Iron ingots', fiber: 'Fiber', herbs: 'Herbs',
    berries: 'Berries', ironTools: 'Iron tools', rawMeat: 'Raw meat', cookedMeat: 'Cooked meat',
    spear: 'Spear', torch: 'Torch', waterskin: 'Waterskin',
    bow: 'Bow', arrows: 'Arrows', pelt: 'Pelts', furCloak: 'Fur cloak',
    cactusFruit: 'Cactus fruit', mushrooms: 'Mushrooms',
    fishingRod: 'Fishing rod', fish: 'Raw fish'
};
// `hits` is the number of swings a node takes by tool tier. A missing tier
// means that tier cannot gather the node at all (bare hands on ore).
export const RESOURCES = {
    tree: { label: 'wood', verb: 'chop', sound: 'chop', debris: 'wood', yields: { wood: 2 }, hits: { hand: 3, stone: 2, iron: 1 } },
    rock: { label: 'stone', verb: 'break', sound: 'mine', debris: 'stone', yields: { stone: 2 }, hits: { hand: 3, stone: 2, iron: 1 } },
    ore: { label: 'iron ore', verb: 'mine', sound: 'mine', debris: 'ore', yields: { ironOre: 2 }, requiresTool: true, hits: { stone: 3, iron: 2 } },
    fiber: { label: 'fiber', verb: 'gather', sound: 'pluck', debris: 'leaf', yields: { fiber: 3 }, hits: { hand: 1, stone: 1, iron: 1 } },
    herb: { label: 'medicinal herbs', verb: 'gather', sound: 'pluck', debris: 'leaf', yields: { herbs: 2 }, hits: { hand: 1, stone: 1, iron: 1 } },
    berry: { label: 'berries', verb: 'pick', sound: 'pluck', debris: 'leaf', yields: { berries: 3 }, hits: { hand: 1, stone: 1, iron: 1 } },
    // Frontier plants: cactus in the desert, mushrooms in the marsh.
    cactus: { label: 'cactus fruit', verb: 'cut', sound: 'chop', debris: 'leaf', yields: { cactusFruit: 2, fiber: 1 }, hits: { hand: 2, stone: 1, iron: 1 } },
    mushroom: { label: 'mushrooms', verb: 'pick', sound: 'pluck', debris: 'leaf', yields: { mushrooms: 2 }, hits: { hand: 1, stone: 1, iron: 1 } }
};
// Days until a gathered node grows back, so a settled camp stays supplied.
export const REGROW_DAYS = { tree: 3, rock: 4, ore: 5, fiber: 2, herb: 2, berry: 2, cactus: 3, mushroom: 2 };

export function toolTier(inventory) {
    return inventory?.ironTools > 0 ? 'iron' : inventory?.tools > 0 ? 'stone' : 'hand';
}
// Swings required with the player's best tool; Infinity when it cannot be gathered yet.
export function hitsNeeded(type, inventory) {
    const hits = RESOURCES[type]?.hits;
    if (!hits) return 1;
    return hits[toolTier(inventory)] ?? Infinity;
}

export const RECIPE_GROUPS = { gear: 'Tools & gear', food: 'Food & healing', materials: 'Materials' };
export const RECIPES = {
    planks: { group: 'materials', name: 'Wooden planks', cost: { wood: 2 }, output: 'planks', amount: 1 },
    iron: { group: 'materials', name: 'Smelt iron', cost: { ironOre: 2, wood: 2 }, output: 'iron', amount: 1 },
    tools: { group: 'gear', name: 'Stone tool', note: 'Gathers faster · mines ore', cost: { planks: 1, stone: 2 }, output: 'tools', amount: 1 },
    spear: { group: 'gear', name: 'Spear', note: '+12 damage · longer reach', cost: { wood: 2, stone: 1, fiber: 1 }, output: 'spear', amount: 1, unique: true },
    torch: { group: 'gear', name: 'Torch', note: 'Light and a little warmth at night', cost: { wood: 1, fiber: 1 }, output: 'torch', amount: 1, unique: true },
    waterskin: { group: 'gear', name: 'Waterskin', note: 'Carries three drinks from any lake', cost: { fiber: 4 }, output: 'waterskin', amount: 1, unique: true },
    fishingRod: { group: 'gear', name: 'Fishing rod', note: 'Stand at a lake shore and click to cast', cost: { wood: 2, fiber: 3 }, output: 'fishingRod', amount: 1, unique: true },
    bow: { group: 'gear', name: 'Bow', note: 'Hold R to draw, release to loose · needs arrows', cost: { wood: 3, fiber: 3 }, output: 'bow', amount: 1, unique: true },
    arrows: { group: 'gear', name: 'Arrows', note: 'Four to a bundle', cost: { wood: 1, stone: 1 }, output: 'arrows', amount: 4 },
    furCloak: { group: 'gear', name: 'Fur cloak', note: 'Halves the cold · pelts come from wolves and bears', cost: { pelt: 3, fiber: 2 }, output: 'furCloak', amount: 1, unique: true },
    ironTools: { group: 'gear', name: 'Iron tool', note: 'Fastest gathering · +8 damage', cost: { iron: 2, planks: 1, fiber: 2 }, output: 'ironTools', amount: 1 },
    bandage: { group: 'food', name: 'Field dressing', cost: { wood: 3 }, heal: 30 },
    herbalWrap: { group: 'food', name: 'Herbal wrap', cost: { fiber: 2, herbs: 2 }, heal: 50 },
    snack: { group: 'food', name: 'Eat berries', cost: { berries: 2 }, heal: 15, hunger: 28 },
    cookMeat: { group: 'food', name: 'Roast meat at campfire', cost: { rawMeat: 1 }, output: 'cookedMeat', amount: 1, requiresFire: true },
    eatMeat: { group: 'food', name: 'Eat cooked meat', cost: { cookedMeat: 1 }, heal: 10, hunger: 50, meal: true },
    eatCactus: { group: 'food', name: 'Eat cactus fruit', cost: { cactusFruit: 1 }, hunger: 8, thirst: 35 },
    // Tonics: a timed effect rather than a meal.
    warmingDraught: { group: 'food', name: 'Brew a warming draught at campfire', cost: { mushrooms: 2, herbs: 1 }, requiresFire: true, buff: 'warmth', effect: 'cold builds 60% slower for 3 minutes' },
    antivenom: { group: 'food', name: 'Mix antivenom', cost: { cactusFruit: 1, herbs: 2 }, buff: 'antivenom', effect: 'cures venom · immune for 2½ minutes' },
    huntersBroth: { group: 'food', name: "Simmer hunter's broth at campfire", cost: { fish: 1, berries: 2 }, requiresFire: true, hunger: 30, buff: 'fury', effect: '+30% damage for 2 minutes', meal: true },
    grillFish: { group: 'food', name: 'Grill fish at campfire', cost: { fish: 1 }, heal: 15, hunger: 40, requiresFire: true, meal: true },
    roastMushrooms: { group: 'food', name: 'Roast mushrooms at campfire', cost: { mushrooms: 2 }, heal: 25, hunger: 32, requiresFire: true, meal: true }
};
export function itemAmount(item, count) {
    const singular = {planks: 'plank', tools: 'stone tool', iron: 'iron ingot', herbs: 'herb', berries: 'berry', ironTools: 'iron tool',
        arrows: 'arrow', pelt: 'pelt', mushrooms: 'mushroom', fish: 'raw fish'};
    return `${count} ${count === 1 && singular[item] ? singular[item] : ITEMS[item].toLowerCase()}`;
}
export function recipeDescription(recipe) {
    const cost = Object.entries(recipe.cost).map(([item, count]) => itemAmount(item, count)).join(' + ');
    return `${cost} → ${recipe.heal || recipe.hunger || recipe.buff ? [recipe.heal && `${recipe.heal} health`, recipe.hunger && `${recipe.hunger} hunger`, recipe.thirst && `${recipe.thirst} thirst`, recipe.effect].filter(Boolean).join(' + ') : itemAmount(recipe.output, recipe.amount)}`;
}
