// Procedural dungeons: where their entrances stand in the world, and how a
// floor is laid out. Pure and seeded: the same site, epoch and floor always
// produce the same rooms, so a floor can be rebuilt after a reload and tested
// without the engine.
import { seededRandom } from './models/wilderness.js';

export const CELL = 3.2; // Metres per grid cell.
export const GRID = 31; // Cells per side.
export const WALL = 0, FLOOR = 1;
export const DUNGEON_SPACING = 176;
export const RESET_DAYS = 3; // Layouts and loot are redrawn every few days.
export const FLOORS = 3;
export const TRAP_CYCLE = 3.4; // Seconds for a spike trap to rest, warn, strike and retract.

// A trap's state at a moment in time: resting, glowing a warning, or raised.
export function trapState(time, phase = 0) {
    const t = ((time + phase) % TRAP_CYCLE + TRAP_CYCLE) % TRAP_CYCLE;
    if (t < 1.8) return {stage: 'rest', raised: 0, t};
    if (t < 2.5) return {stage: 'warn', raised: 0, t};
    if (t < 3.15) return {stage: 'up', raised: Math.min(1, (t - 2.5) / .08), t};
    return {stage: 'rest', raised: Math.max(0, 1 - (t - 3.15) / .25), t};
}

// Each dungeon has a look and a temperature, fixed by where it is.
export const THEMES = Object.freeze([
    {id: 'crypt', label: 'crypt', floor: [.44, .43, .46], wall: [.56, .55, .6], roof: [.22, .22, .26],
        fog: [.012, .012, .02], ambient: [.5, .54, .68], chill: -.25},
    {id: 'cavern', label: 'cavern', floor: [.42, .35, .26], wall: [.5, .41, .3], roof: [.2, .17, .13],
        fog: [.022, .016, .01], ambient: [.66, .56, .44], chill: -.25},
    {id: 'frost', label: 'frozen vault', floor: [.5, .58, .66], wall: [.62, .72, .8], roof: [.24, .3, .36],
        fog: [.03, .045, .06], ambient: [.56, .68, .84], chill: .4}
]);
export function themeFor(site) {
    if (!site || site.id === 'dungeon:start') return THEMES[0];
    let hashed = 7;
    for (let i = 0; i < site.id.length; i++) hashed = Math.imul(hashed ^ site.id.charCodeAt(i), 16777619);
    return THEMES[Math.abs(hashed) % THEMES.length];
}

const NAMES = ['Sunken Crypt', 'Forgotten Vault', 'Hollow Stair', 'Buried Sanctum', 'Silent Barrow', 'Drowned Cellar', 'Ashen Catacomb'];
// The first dungeon sits beside the trail crossing south-west of the clearing.
export const STARTER_DUNGEON = Object.freeze({id: 'dungeon:start', name: 'Old Barrow', x: -40, z: -56, tier: 1});

const hash = (a, b, salt) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ salt) | 0;
const isLake = (x, z) => Math.sin(x * .005) * Math.cos(z * .005) > .56;

export function dungeonForCell(cx, cz) {
    if (cx === 0 && cz === 0) return null; // The starter dungeon owns the home cell.
    if (cx === -1 && cz === -1) return null; // Keep clear of the starter dungeon itself.
    const random = seededRandom(hash(cx, cz, 0x5d1a));
    if (random() < .22) return null; // Not every region hides one.
    let x = 0, z = 0, dry = false;
    for (let attempt = 0; attempt < 8 && !dry; attempt++) {
        x = cx * DUNGEON_SPACING + 24 + random() * (DUNGEON_SPACING - 48);
        z = cz * DUNGEON_SPACING + 24 + random() * (DUNGEON_SPACING - 48);
        dry = !isLake(x, z);
    }
    if (!dry) return null;
    const distance = Math.hypot(x, z);
    return {
        id: 'dungeon:' + cx + ':' + cz, name: NAMES[Math.floor(random() * NAMES.length)],
        x, z, tier: 1 + Math.min(8, Math.floor(distance / 260))
    };
}

export function dungeonsNear(x, z, radius = 200) {
    const result = Math.hypot(STARTER_DUNGEON.x - x, STARTER_DUNGEON.z - z) <= radius ? [STARTER_DUNGEON] : [];
    const range = Math.ceil(radius / DUNGEON_SPACING);
    const centerX = Math.floor(x / DUNGEON_SPACING), centerZ = Math.floor(z / DUNGEON_SPACING);
    for (let cx = centerX - range; cx <= centerX + range; cx++) {
        for (let cz = centerZ - range; cz <= centerZ + range; cz++) {
            const site = dungeonForCell(cx, cz);
            if (site && Math.hypot(site.x - x, site.z - z) <= radius) result.push(site);
        }
    }
    return result;
}

// The layout of a dungeon changes every RESET_DAYS days.
export const dungeonEpoch = day => Math.floor((Math.max(1, day) - 1) / RESET_DAYS);
export const daysUntilReset = day => RESET_DAYS - ((Math.max(1, day) - 1) % RESET_DAYS);

export function floorSeed(siteId, epoch, floor) {
    let seed = 0x9e3779b9 ^ Math.imul(epoch + 1, 0x85ebca6b) ^ Math.imul(floor, 0xc2b2ae35);
    for (let i = 0; i < siteId.length; i++) seed = Math.imul(seed ^ siteId.charCodeAt(i), 16777619);
    return seed | 0;
}

const index = (x, y) => y * GRID + x;
const inside = (x, y) => x >= 1 && y >= 1 && x < GRID - 1 && y < GRID - 1;

// Enemy mix by floor: [kind, weight].
const ROSTER = {
    1: [['spider', 4], ['bat', 3], ['skeleton', 3], ['slime', 2]],
    2: [['spider', 3], ['bat', 2], ['skeleton', 4], ['wraith', 2], ['slime', 3]],
    3: [['spider', 2], ['bat', 2], ['skeleton', 4], ['wraith', 3], ['slime', 2]]
};
function weighted(list, random) {
    let roll = random() * list.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [value, weight] of list) { roll -= weight; if (roll <= 0) return value; }
    return list[list.length - 1][0];
}

// Breadth-first distance (in cells) from one cell to every reachable floor cell.
export function flowField(grid, fromX, fromY) {
    const field = new Int16Array(GRID * GRID).fill(-1);
    if (!inside(fromX, fromY) || grid[index(fromX, fromY)] !== FLOOR) return field;
    const queue = [index(fromX, fromY)];
    field[queue[0]] = 0;
    for (let head = 0; head < queue.length; head++) {
        const at = queue[head], x = at % GRID, y = (at - x) / GRID;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const next = index(x + dx, y + dy);
            if (grid[next] === FLOOR && field[next] < 0) { field[next] = field[at] + 1; queue.push(next); }
        }
    }
    return field;
}

export function generateFloor(seed, floor = 1, lastFloor = FLOORS) {
    const random = seededRandom(seed);
    const grid = new Uint8Array(GRID * GRID);
    const rooms = [];
    const boss = floor >= lastFloor;
    const overlaps = (x, y, w, h) => rooms.some(room =>
        x - 1 < room.x + room.w && x + w + 1 > room.x && y - 1 < room.y + room.h && y + h + 1 > room.y);
    const addRoom = (x, y, w, h, kind = 'room') => {
        const room = {x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), kind, links: 0};
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[index(i, j)] = FLOOR;
        rooms.push(room);
        return room;
    };
    // The boss floor is built around one great hall.
    if (boss) {
        const size = 9;
        addRoom(2 + Math.floor(random() * (GRID - size - 4)), 2 + Math.floor(random() * (GRID - size - 4)), size, size, 'boss');
    }
    const wanted = 7 + Math.floor(random() * 3) + Math.min(2, floor - 1);
    for (let attempt = 0; attempt < 220 && rooms.length < wanted; attempt++) {
        const w = 3 + Math.floor(random() * 4), h = 3 + Math.floor(random() * 4);
        const x = 1 + Math.floor(random() * (GRID - w - 2)), y = 1 + Math.floor(random() * (GRID - h - 2));
        if (!overlaps(x, y, w, h)) addRoom(x, y, w, h);
    }

    // Join every room with a minimum spanning tree of L-shaped corridors,
    // then add a couple of extra passages so there are loops to circle through.
    const carve = (a, b) => {
        let x = a.cx, y = a.cy;
        const horizontalFirst = random() < .5;
        const walkX = () => { while (x !== b.cx) { grid[index(x, y)] = FLOOR; x += Math.sign(b.cx - x); } };
        const walkY = () => { while (y !== b.cy) { grid[index(x, y)] = FLOOR; y += Math.sign(b.cy - y); } };
        if (horizontalFirst) { walkX(); walkY(); } else { walkY(); walkX(); }
        grid[index(x, y)] = FLOOR;
        a.links++; b.links++;
    };
    const gap = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
    const joined = [rooms[0]], waiting = rooms.slice(1);
    while (waiting.length) {
        let best = null;
        for (const from of joined) for (const to of waiting) {
            if (!best || gap(from, to) < best.distance) best = {from, to, distance: gap(from, to)};
        }
        carve(best.from, best.to);
        joined.push(best.to);
        waiting.splice(waiting.indexOf(best.to), 1);
    }
    for (let extra = 0; extra < 2; extra++) {
        const a = rooms[Math.floor(random() * rooms.length)], b = rooms[Math.floor(random() * rooms.length)];
        if (a !== b && gap(a, b) < 16) carve(a, b);
    }

    // Enter as far as possible from the way onward.
    const goal = boss ? rooms[0] : null;
    let start;
    if (goal) {
        const field = flowField(grid, goal.cx, goal.cy);
        start = rooms.slice(1).reduce((far, room) => field[index(room.cx, room.cy)] > field[index(far.cx, far.cy)] ? room : far);
    } else start = rooms[Math.floor(random() * rooms.length)];
    start.kind = 'start';
    const fromStart = flowField(grid, start.cx, start.cy);
    const exitRoom = goal || rooms.filter(room => room !== start)
        .reduce((far, room) => fromStart[index(room.cx, room.cy)] > fromStart[index(far.cx, far.cy)] ? room : far);
    if (!goal) exitRoom.kind = 'exit';

    const taken = new Set([index(start.cx, start.cy), index(exitRoom.cx, exitRoom.cy)]);
    const freeCell = room => {
        for (let attempt = 0; attempt < 30; attempt++) {
            const x = room.x + Math.floor(random() * room.w), y = room.y + Math.floor(random() * room.h);
            if (!taken.has(index(x, y))) { taken.add(index(x, y)); return {x, y}; }
        }
        return null;
    };

    // Treasure favours dead ends; every floor has at least one chest to find.
    const chests = [];
    const ordinary = rooms.filter(room => room.kind === 'room');
    for (const room of ordinary) {
        if (random() < (room.links <= 1 ? .85 : .3)) {
            const cell = freeCell(room);
            if (cell) chests.push({...cell, tier: 'chest'});
        }
    }
    const minimum = floor >= 2 ? 2 : 1;
    for (let attempt = 0; chests.length < minimum && attempt < 20 && ordinary.length; attempt++) {
        const cell = freeCell(ordinary[Math.floor(random() * ordinary.length)]);
        if (cell) chests.push({...cell, tier: 'chest'});
    }
    if (boss) chests.push({x: exitRoom.cx, y: exitRoom.y + 1, tier: 'boss'});

    // Enemies: none in the entry room, more of them on deeper floors.
    const spawns = [];
    const roster = ROSTER[Math.min(3, floor)];
    for (const room of rooms) {
        if (room === start || room.kind === 'boss') continue;
        const count = Math.min(Math.floor(room.w * room.h / 5), 1 + Math.floor(random() * (1.4 + floor * .8)));
        for (let n = 0; n < count; n++) {
            const cell = freeCell(room);
            if (cell) spawns.push({...cell, kind: weighted(roster, random)});
        }
    }
    if (boss) spawns.push({x: exitRoom.cx, y: exitRoom.cy, kind: 'warden'});

    // A lit brazier in two corners of most rooms.
    const braziers = [];
    for (const room of rooms) {
        if (room.w < 4 && room.h < 4 && random() < .5) continue;
        for (const [x, y] of [[room.x, room.y], [room.x + room.w - 1, room.y + room.h - 1]]) {
            if (!taken.has(index(x, y))) { taken.add(index(x, y)); braziers.push({x, y}); }
        }
    }

    // --- Dangers and rewards layered on afterwards (drawn last, so the rooms,
    // chests and spawns above stay exactly as earlier versions generated them).
    // Spike traps guard straight stretches of corridor, never the first steps in.
    const inRoom = (x, y) => rooms.some(room => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h);
    const open = (x, y) => grid[index(x, y)] === FLOOR;
    const straights = [];
    for (let y = 1; y < GRID - 1; y++) for (let x = 1; x < GRID - 1; x++) {
        if (!open(x, y) || inRoom(x, y) || fromStart[index(x, y)] < 3) continue;
        const eastWest = open(x - 1, y) && open(x + 1, y) && !open(x, y - 1) && !open(x, y + 1);
        const northSouth = open(x, y - 1) && open(x, y + 1) && !open(x - 1, y) && !open(x + 1, y);
        if (eastWest || northSouth) straights.push({x, y});
    }
    const traps = [];
    const wantedTraps = Math.min(straights.length, floor + (random() < .5 ? 1 : 0));
    for (let attempt = 0; attempt < 60 && traps.length < wantedTraps; attempt++) {
        const cell = straights[Math.floor(random() * straights.length)];
        if (traps.some(trap => Math.abs(trap.x - cell.x) + Math.abs(trap.y - cell.y) < 3)) continue;
        traps.push({...cell, phase: random() * TRAP_CYCLE});
    }
    // A shrine waits in a side room on most floors.
    let shrine = null;
    if (ordinary.length && random() < .6) shrine = freeCell(ordinary[Math.floor(random() * ordinary.length)]);
    // Below the first floor some chests bite, but never every one of them.
    const plain = chests.filter(chest => chest.tier === 'chest');
    if (floor >= 2) for (const chest of plain) if (random() < .24) chest.mimic = true;
    if (plain.length && plain.every(chest => chest.mimic)) plain[0].mimic = false;
    // One creature on the floor is an elite: tougher, and carrying gear.
    const ranks = spawns.filter(spawn => spawn.kind !== 'warden' && spawn.kind !== 'bat');
    if (ranks.length && (floor >= 2 || random() < .5)) ranks[Math.floor(random() * ranks.length)].elite = true;

    return {
        seed, floor, boss, grid, rooms, chests, spawns, braziers, traps, shrine,
        start: {x: start.cx, y: start.cy},
        exit: {x: exitRoom.cx, y: exitRoom.cy}
    };
}

// --- Geometry helpers shared by the player, enemies and the minimap ---------
// A floor is placed in the world with its grid centred on (originX, originZ).
export const cellOf = (layout, wx, wz) => ({
    x: Math.floor((wx - layout.originX) / CELL), y: Math.floor((wz - layout.originZ) / CELL)
});
export const centreOf = (layout, x, y) => ({
    x: layout.originX + (x + .5) * CELL, z: layout.originZ + (y + .5) * CELL
});
export function isOpen(layout, x, y) {
    return x >= 0 && y >= 0 && x < GRID && y < GRID && layout.grid[index(x, y)] === FLOOR;
}

// Keep a circle of `radius` out of the walls. Returns the corrected position.
export function resolveCircle(layout, wx, wz, radius = .7) {
    let x = wx, z = wz;
    const {x: cx, y: cy} = cellOf(layout, x, z);
    // Standing inside solid rock (a teleport gone wrong): snap to the nearest open cell.
    if (!isOpen(layout, cx, cy)) {
        let best = null;
        for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
            if (layout.grid[index(i, j)] !== FLOOR) continue;
            const centre = centreOf(layout, i, j), distance = Math.hypot(centre.x - x, centre.z - z);
            if (!best || distance < best.distance) best = {...centre, distance};
        }
        return best ? {x: best.x, z: best.z} : {x, z};
    }
    for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
        if (isOpen(layout, i, j)) continue;
        const minX = layout.originX + i * CELL, minZ = layout.originZ + j * CELL;
        const nearX = Math.max(minX, Math.min(x, minX + CELL)), nearZ = Math.max(minZ, Math.min(z, minZ + CELL));
        const dx = x - nearX, dz = z - nearZ, distance = Math.hypot(dx, dz);
        if (distance >= radius) continue;
        if (distance > 1e-6) { x = nearX + dx / distance * radius; z = nearZ + dz / distance * radius; }
    }
    return {x, z};
}

// True when nothing solid lies on the straight line between two points.
export function lineOfSight(layout, ax, az, bx, bz) {
    const distance = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(distance / (CELL * .3)));
    for (let step = 1; step < steps; step++) {
        const t = step / steps;
        const cell = cellOf(layout, ax + (bx - ax) * t, az + (bz - az) * t);
        if (!isOpen(layout, cell.x, cell.y)) return false;
    }
    return true;
}
