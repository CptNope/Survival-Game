// Shared by gathering, crafting and the HUD so quantities and labels stay in sync.
export const ITEMS = {
    wood: 'Wood', stone: 'Stone', planks: 'Planks', tools: 'Stone tools',
    ironOre: 'Iron ore', iron: 'Iron ingots', fiber: 'Fiber', herbs: 'Herbs',
    berries: 'Berries', ironTools: 'Iron tools', rawMeat: 'Raw meat', cookedMeat: 'Cooked meat'
};
export const RESOURCES = {
    tree: { label: 'wood', yields: { wood: 2 } },
    rock: { label: 'stone', yields: { stone: 2 } },
    ore: { label: 'iron ore', yields: { ironOre: 2 }, requiresTool: true },
    fiber: { label: 'fiber', yields: { fiber: 3 } },
    herb: { label: 'medicinal herbs', yields: { herbs: 2 } },
    berry: { label: 'berries', yields: { berries: 3 } }
};
export const RECIPES = {
    planks: { name: 'Wooden planks', cost: { wood: 2 }, output: 'planks', amount: 1 },
    tools: { name: 'Stone tool', cost: { planks: 1, stone: 2 }, output: 'tools', amount: 1 },
    bandage: { name: 'Field dressing', cost: { wood: 3 }, heal: 30 },
    herbalWrap: { name: 'Herbal wrap', cost: { fiber: 2, herbs: 2 }, heal: 50 },
    snack: { name: 'Eat berries', cost: { berries: 2 }, heal: 15, hunger: 28 },
    cookMeat: { name: 'Roast meat at campfire', cost: { rawMeat: 1 }, output: 'cookedMeat', amount: 1, requiresFire: true },
    eatMeat: { name: 'Eat cooked meat', cost: { cookedMeat: 1 }, heal: 10, hunger: 50 },
    iron: { name: 'Smelt iron', cost: { ironOre: 2, wood: 2 }, output: 'iron', amount: 1 },
    ironTools: { name: 'Iron tool', cost: { iron: 2, planks: 1, fiber: 2 }, output: 'ironTools', amount: 1 }
};
export function itemAmount(item, count) {
    const singular = {planks: 'plank', tools: 'stone tool', iron: 'iron ingot', herbs: 'herb', berries: 'berry', ironTools: 'iron tool'};
    return `${count} ${count === 1 && singular[item] ? singular[item] : ITEMS[item].toLowerCase()}`;
}
export function recipeDescription(recipe) {
    const cost = Object.entries(recipe.cost).map(([item, count]) => itemAmount(item, count)).join(' + ');
    return `${cost} → ${recipe.heal || recipe.hunger ? [recipe.heal && `${recipe.heal} health`, recipe.hunger && `${recipe.hunger} hunger`].filter(Boolean).join(' + ') : itemAmount(recipe.output, recipe.amount)}`;
}
