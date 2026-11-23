// The world map: what colour each patch of country is, and where things sit
// on the sheet. Pure, so the picture can be checked without a browser.
import { regionAt, REGIONS } from './regions.js';

export const MAP_SPAN = 1800;   // Metres across the sheet.
export const MAP_CELLS = 90;    // Cells across: 20 m each.
export const MAP_COLORS = Object.freeze({
    meadow: '#5c8743', tundra: '#dfe8ee', desert: '#d3aa68', marsh: '#3c5633', water: '#3f80ad', unknown: '#27302b'
});

// The map's colours for a season. `ground` is a season look's ground colours
// (see seasons.js); the Greenwood and Mirefen move as far from their summer
// map colour as the land itself has moved from its summer ground. Everything
// else, and every colour in summer, is as drawn above.
export function mapColors(ground = null) {
    if (!ground) return MAP_COLORS;
    const out = {...MAP_COLORS};
    for (const id of ['meadow', 'marsh']) {
        const now = ground[id], was = REGIONS[id]?.ground;
        if (!now || !was) continue;
        const base = [1, 3, 5].map(at => parseInt(MAP_COLORS[id].slice(at, at + 2), 16));
        out[id] = '#' + base.map((value, c) => {
            const shift = ((now[0][c] + now[1][c]) - (was[0][c] + was[1][c])) / 2 * 255;
            return Math.max(0, Math.min(255, Math.round(value + shift))).toString(16).padStart(2, '0');
        }).join('');
    }
    return out;
}

// One code per cell, row by row from the north-west corner. Country of a
// region you have never set foot in is drawn as unknown.
export function mapCells(centreX, centreZ, discovered, isWater = () => false, span = MAP_SPAN, cells = MAP_CELLS) {
    const out = new Array(cells * cells), step = span / cells;
    for (let row = 0; row < cells; row++) for (let column = 0; column < cells; column++) {
        const x = centreX - span / 2 + (column + .5) * step, z = centreZ + span / 2 - (row + .5) * step;
        const region = regionAt(x, z);
        out[row * cells + column] = !discovered.has(region) ? 'unknown' : isWater(x, z) ? 'water' : region;
    }
    return out;
}

// World metres to sheet pixels: north is up, east is right.
export function toSheet(x, z, centreX, centreZ, size, span = MAP_SPAN) {
    return {px: (x - centreX) / span * size + size / 2, py: size / 2 - (z - centreZ) / span * size};
}

export const onSheet = (point, size, margin = 0) =>
    point.px >= margin && point.py >= margin && point.px <= size - margin && point.py <= size - margin;
