// How hard the Wilds push back. A device preference, like sound or graphics:
// it can be changed at any time and applies from that moment. Pure numbers.
export const DIFFICULTIES = Object.freeze(['gentle', 'standard', 'harsh']);

// damage: what a blow from anything that attacks does to you
// needs:  how fast hunger, thirst and the cold build
// pack:   how many more or fewer come on a pack night
// alphas: whether an alpha wolf can turn up on an ordinary night
export const DIFFICULTY = Object.freeze({
    gentle: {label: 'Gentle', note: 'Blows hurt 40% less, hunger, thirst and cold build 30% slower, and packs come one short',
        damage: .6, needs: .7, pack: -1, alphas: false},
    standard: {label: 'Standard', note: 'The Wilds as they were made',
        damage: 1, needs: 1, pack: 0, alphas: true},
    harsh: {label: 'Harsh', note: 'Blows hurt 40% more, hunger, thirst and cold build a quarter faster, and packs come one stronger',
        damage: 1.4, needs: 1.25, pack: 1, alphas: true}
});

// The numbers for a settings object, or for a game. Anything unrecognised is Standard.
export const difficultyOf = settings => DIFFICULTY[settings?.difficulty] || DIFFICULTY.standard;
