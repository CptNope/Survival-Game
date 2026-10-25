// Craftable base structures with one merged mesh each; active meshes stream
// around the player, while compact structure records are persisted by SaveSystem.
export const BUILDINGS = Object.freeze({
    shelter: {name: 'Lean-to shelter', cost: {wood: 6, planks: 2, fiber: 3}},
    fire: {name: 'Campfire', cost: {wood: 3, stone: 3}},
    floor: {name: 'Wooden floor', cost: {planks: 2}},
    wall: {name: 'Log wall', cost: {wood: 4}},
    roof: {name: 'Wooden roof', cost: {planks: 3, fiber: 2}}
});

function createModel(scene, type, item, material) {
    const pieces = [];
    const color = {
        wood: [.40,.28,.18], roof: [.31,.37,.24],
        stone: [.42,.43,.40], ember: [.93,.39,.15], ash: [.18,.17,.15]
    };
    function tint(mesh, shade) {
        const rgb = color[shade], values = [];
        for (let i = 0; i < mesh.getTotalVertices(); i++) values.push(...rgb, 1);
        mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, values);
        pieces.push(mesh);
    }
    function beam(name, x, y, z, w, h, d, shade, tilt = 0) {
        const mesh = BABYLON.MeshBuilder.CreateBox(name, {width:w,height:h,depth:d},scene);
        mesh.position.set(x,y,z); mesh.rotation.x = tilt;
        tint(mesh,shade);
    }
    if (type === 'shelter') {
        beam('base-platform', 0,.12,0,4,.22,3.3,'wood');
        beam('rear-wall', 0,1.35,-1.5,4,2.65,.18,'wood');
        for (const x of [-1.85,1.85]) {
            beam('support', x,1.4,1.35,.24,2.8,.24,'wood');
            beam('back-support', x,1.65,-1.5,.24,3.3,.24,'wood');
        }
        beam('sloping-roof', 0,2.85,-.05,4.5,.23,4,'roof',-.16);
        beam('sleep-mat', 0,.34,-.5,1.8,.1,1.35,'roof');
    } else if (type === 'floor') {
        beam('modular-floor',0,.13,0,4,.26,4,'wood');
        for(let x of [-1.8,1.8]) beam('foundation-edge',x,.1,0,.25,.36,4,'roof');
    } else if (type === 'wall') {
        for(let i=0;i<5;i++) beam('log-wall',0,.4+i*.55,0,4,.48,.42,'wood');
        for(let x of [-1.8,1.8]) beam('wall-support',x,1.4,0,.2,2.8,.6,'roof');
    } else if (type === 'roof') {
        beam('roof-slab',0,3.15,0,4.5,.25,4.5,'roof');
        for(let x of [-1.8,1.8]) beam('roof-rafter',x,2.97,0,.26,.24,4,'wood');
    } else {
        for (let i=0;i<8;i++) {
            const a=i*Math.PI/4;
            const rock=BABYLON.MeshBuilder.CreateIcoSphere('fire-ring', {radius:.34,subdivisions:1,flat:true},scene);
            rock.position.set(Math.cos(a)*.85,.2,Math.sin(a)*.85);
            tint(rock,'stone');
        }
        for (let i=0;i<3;i++) {
            const log=BABYLON.MeshBuilder.CreateCylinder('firewood',{height:1.35,diameter:.2,tessellation:6},scene);
            log.position.set(0,.25,0);log.rotation.z=Math.PI/2;
            log.rotation.y=i*Math.PI/3;
            tint(log,'wood');
        }
        const coal=BABYLON.MeshBuilder.CreateCylinder('coals',{height:.3,diameter:.7,tessellation:7},scene);
        coal.position.y=.3; tint(coal,'ember');
    }
    const mesh=BABYLON.Mesh.MergeMeshes(pieces,true,true);
    if (!mesh) return null;
    mesh.name='player-' + type + '-' + item.id;
    mesh.position.set(item.x,item.y,item.z);
    mesh.rotation.y=item.rotation;
    mesh.material=material;
    mesh.checkCollisions=type==='shelter' || type==='wall';
    mesh.isPickable=false; // Do not block harvesting or targeting behind a structure.
    mesh.receiveShadows=false;
    return mesh;
}

export class BuildingSystem {
    constructor(game) {
        this.game=game;
        this.structures=[];
        this.meshes=new Map();
        this.nextId=1;
        this.maxStructures=120;
        this.lastStreamAt=0;
        this.material=new BABYLON.StandardMaterial('built-structure',game.scene);
        this.material.diffuseColor=BABYLON.Color3.White();
        this.material.specularColor=BABYLON.Color3.Black();
    }

    canAfford(type) {
        const recipe=BUILDINGS[type];
        const inventory=this.game.inventorySystem?.inventory;
        return Boolean(recipe && inventory && Object.entries(recipe.cost)
            .every(([item,needed])=>(inventory[item] || 0)>=needed));
    }

    candidate(type = 'shelter') {
        const player=this.game.playerSystem;
        if (player.isDead || player.isFlying) return null;
        const pos=player.camera.position;
        const heading=player.camera.rotation.y;
        const modular=['floor','wall','roof'].includes(type);
        const step=modular?4:2;
        const x=Math.round((pos.x+Math.sin(heading)*6)/step)*step;
        const z=Math.round((pos.z+Math.cos(heading)*6)/step)*step;
        const terrain=this.game.terrainSystem;
        if (terrain.isWaterArea(x,z)) return null;
        const y=terrain.getPerlinHeight(x,z);
        if (!Number.isFinite(y)) return null;
        const heights=[[3,0],[-3,0],[0,3],[0,-3]]
            .map(([dx,dz])=>terrain.getPerlinHeight(x+dx,z+dz));
        if (heights.some(h=>Math.abs(h-y)>1.6)) return null;
        // Modular pieces can share a 4m grid cell with complementary
        // pieces, but never overlap the same type at that location.
        if (this.structures.some(s => {
            const distance=Math.hypot(s.x-x,s.z-z);
            if(!modular || !['floor','wall','roof'].includes(s.type)) return distance<7;
            return distance<1 && s.type===type;
        })) return null;
        if (this.game.inventorySystem.harvestableObjects.some(o =>
            o.mesh && Math.hypot(o.mesh.position.x-x,o.mesh.position.z-z)<3)) return null;
        if (this.game.explorationSystem?.isClearing(x,z) && !terrain.isWithinSpawnArea(x,z)) return null;
        return {x,y,z,rotation:Math.round(heading/(Math.PI/4))*(Math.PI/4)};
    }

    place(type) {
        if (!BUILDINGS[type] || this.game.playerSystem.isDead || this.structures.length>=this.maxStructures) return false;
        if (!this.canAfford(type)) {
            this.game.uiSystem?.showNotification('Not enough resources to build ' + BUILDINGS[type].name);
            return false;
        }
        const at=this.candidate(type);
        if (!at) {
            this.game.uiSystem?.showNotification('Need clear, dry, fairly level ground ahead');
            return false;
        }
        const inv=this.game.inventorySystem.inventory;
        for (const [item,cost] of Object.entries(BUILDINGS[type].cost)) inv[item]-=cost;
        const record={id:this.nextId++,type,...at};
        this.structures.push(record);
        this.createVisible(record);
        this.game.uiSystem?.updateInventoryUI();
        this.game.uiSystem?.showNotification(BUILDINGS[type].name + ' built');
        this.game.saveSystem?.save();
        return true;
    }

    createVisible(record) {
        if (this.meshes.has(record.id)) return;
        const mesh=createModel(this.game.scene,record.type,record,this.material);
        if (mesh) this.meshes.set(record.id,mesh);
    }

    isProtected(position) {
        return this.structures.some(item => {
            const radius=item.type==='shelter'?8:item.type==='fire'?5:item.type==='roof'?3:0;
            return radius>0 && Math.hypot(position.x-item.x,position.z-item.z)<=radius;
        });
    }

    nearFire(position) {
        return this.structures.some(item => item.type==='fire' &&
            Math.hypot(position.x-item.x,position.z-item.z)<=6);
    }

    update() {
        if (!this.game.playerSystem) return;
        const pos=this.game.playerSystem.camera.position;
        for(const item of this.structures){
            const dist=Math.hypot(pos.x-item.x,pos.z-item.z);
            if(dist<125) this.createVisible(item);
            else if(dist>150 && this.meshes.has(item.id)){
                this.meshes.get(item.id).dispose(false,false);
                this.meshes.delete(item.id);
            }
        }
    }

    restore(records) {
        for(const mesh of this.meshes.values()) mesh.dispose(false,false);
        this.meshes.clear();
        this.structures=[];
        this.nextId=1;
        const seen=new Set();
        for(const item of Array.isArray(records)?records.slice(0,this.maxStructures):[]){
            if(!item || !BUILDINGS[item.type] || !Number.isInteger(item.id) || item.id<1 || seen.has(item.id)) continue;
            if(![item.x,item.y,item.z,item.rotation].every(n=>Number.isFinite(n)&&Math.abs(n)<100000)) continue;
            seen.add(item.id);
            this.structures.push({id:item.id,type:item.type,x:item.x,y:item.y,z:item.z,rotation:item.rotation});
            this.nextId=Math.max(this.nextId,item.id+1);
        }
        this.update();
    }
}
