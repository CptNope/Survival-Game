// First-person, third-person and overhead views. The original first-person
// camera stays the player's "body": it still takes all movement and look
// input and every system still reads its position. In the other views a
// second camera does the looking and the body is drawn as an avatar.
import { VIEW_LABELS, ZOOM, isView, nextView, clampZoom, cameraRig, clampRig, coneTarget } from '../view.js';
import { cellOf, isOpen, lineOfSight } from '../dungeon.js';
import { createAvatarModel } from '../models/avatar.js';
import { createAxeModel, createSpearModel, createTorchModel } from '../models/wilderness.js';
import { CREATURES } from '../creatures.js';

const EYE_HEIGHT = 2;

export class ViewSystem {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.body = game.playerSystem.camera;
        this.mode = 'first';
        this.zoom = {third: ZOOM.third.start, overhead: ZOOM.overhead.start};
        this.camera = new BABYLON.TargetCamera('viewCamera', this.body.position.clone(), this.scene);
        this.camera.fov = this.body.fov;
        this.camera.minZ = .1;
        this.avatar = createAvatarModel(this.scene);
        this.avatar.root.setEnabled(false);
        game.registerModelShadow?.(this.avatar.root);
        this.heldKind = null;
        this.held = null;
        this.torch = null;
        this.walk = 0;
        this.last = {x: this.body.position.x, z: this.body.position.z};
        this.target = null;
        this.marker = this.createMarker();
        this.targetTimer = 0;
        this.setMode(isView(game.settings?.view) ? game.settings.view : 'first', false);
    }

    createMarker() {
        const ring = BABYLON.MeshBuilder.CreateTorus('target-marker', {diameter: 1.7, thickness: .09, tessellation: 24}, this.scene);
        const material = new BABYLON.StandardMaterial('target-marker-mat', this.scene);
        material.emissiveColor = new BABYLON.Color3(1, .86, .4);
        material.diffuseColor = BABYLON.Color3.Black();
        material.specularColor = BABYLON.Color3.Black();
        material.disableLighting = true;
        material.fogEnabled = false;
        ring.material = material;
        ring.isPickable = false;
        ring.setEnabled(false);
        return ring;
    }

    get firstPerson() { return this.mode === 'first'; }

    setMode(mode, announce = true) {
        if (!isView(mode)) return false;
        const game = this.game;
        this.mode = mode;
        this.scene.activeCamera = this.firstPerson ? this.body : this.camera;
        this.avatar.root.setEnabled(!this.firstPerson);
        this.marker.setEnabled(false);
        game.effects?.setFirstPerson?.(this.firstPerson);
        game.dungeonSystem?.setCeilingVisible?.(mode !== 'overhead');
        if (typeof document !== 'undefined') {
            document.body?.classList.toggle('view-overhead', mode === 'overhead');
            document.body?.classList.toggle('view-third', mode === 'third');
        }
        this.refreshHeld();
        if (!this.firstPerson) this.place();
        if (announce) {
            game.updateSettings?.({view: mode});
            const touch = Boolean(game.touchControls?.enabled);
            game.uiSystem?.showNotification?.(VIEW_LABELS[mode] + (this.firstPerson ? '' : touch ? ' · Pinch to zoom' : ' · Mouse wheel zooms'));
            game.audio?.play('click');
        }
        return true;
    }

    cycle() { return this.setMode(nextView(this.mode)); }

    // Mouse wheel: closer or farther in the two outside views.
    zoomBy(steps) {
        if (this.firstPerson) return false;
        this.zoom[this.mode] = clampZoom(this.mode, this.zoom[this.mode] + steps * (this.mode === 'overhead' ? 2 : .7));
        return true;
    }

    // Is a point open air? Used to keep the third-person camera out of walls and hills.
    clear(x, y, z) {
        const game = this.game, dungeon = game.dungeonSystem;
        if (dungeon?.active) {
            const cell = cellOf(dungeon.layout, x, z);
            return isOpen(dungeon.layout, cell.x, cell.y) && y > dungeon.floorY + .35 && y < dungeon.floorY + dungeon.ceiling - .3;
        }
        return y > game.terrainSystem.getPerlinHeight(x, z) + .45;
    }

    // Put the view camera where this mode wants it.
    place() {
        const eye = this.body.position;
        // A tall, narrow screen needs the camera further back to show the same ground.
        const engine = this.game.engine, wide = engine?.getRenderWidth?.() || 16, tall = engine?.getRenderHeight?.() || 9;
        const distance = this.zoom[this.mode] * (wide < tall ? 1.3 : 1);
        const rig = cameraRig(this.mode, eye, this.body.rotation.y, this.body.rotation.x, distance);
        let position = rig.position;
        if (this.mode === 'third') position = clampRig(rig, {x: eye.x, y: eye.y + .2, z: eye.z}, (x, y, z) => this.clear(x, y, z));
        // Backed against a wall, the camera ends up inside the player's head:
        // stop drawing the avatar until there is room again.
        this.cramped = this.mode === 'third' && position.fraction * distance < 1.7;
        this.avatar.root.setEnabled(!this.firstPerson && !this.cramped);
        this.camera.position.set(position.x, position.y, position.z);
        this.camera.setTarget(new BABYLON.Vector3(rig.target.x, rig.target.y, rig.target.z));
    }

    // --- The avatar ---------------------------------------------------------
    refreshHeld() {
        const effects = this.game.effects;
        const kind = this.firstPerson ? null : effects?.heldKind || null;
        if (kind !== this.heldKind) {
            this.held?.dispose(false, true);
            this.held = null;
            this.heldKind = kind;
            if (kind) {
                const mesh = kind === 'spear' ? createSpearModel(this.scene) : createAxeModel(this.scene, kind === 'ironTools');
                mesh.parent = this.avatar.rightHand;
                mesh.isPickable = false;
                if (kind === 'spear') { mesh.scaling.setAll(.75); mesh.rotation.x = -.25; mesh.position.z = .35; }
                else { mesh.scaling.setAll(.85); mesh.rotation.x = 1.2; mesh.position.set(0, .05, .25); }
                this.held = mesh;
            }
        }
        const lit = Boolean(!this.firstPerson && effects?.torchLit);
        if (lit && !this.torch) {
            this.torch = createTorchModel(this.scene);
            this.torch.parent = this.avatar.leftHand;
            this.torch.isPickable = false;
            this.torch.scaling.setAll(.9);
            this.torch.rotation.x = .5;
            this.torch.position.set(0, .15, .1);
            this.torch.material.emissiveColor = new BABYLON.Color3(.5, .32, .14);
        }
        this.torch?.setEnabled(lit);
    }

    animate(dt) {
        const game = this.game, player = game.playerSystem, body = this.body, avatar = this.avatar;
        const moved = Math.hypot(body.position.x - this.last.x, body.position.z - this.last.z);
        this.last.x = body.position.x; this.last.z = body.position.z;
        const speed = Math.min(12, moved / Math.max(dt, .001));
        avatar.root.position.set(body.position.x, body.position.y - EYE_HEIGHT, body.position.z);
        avatar.root.rotation.y = body.rotation.y;
        // Lean into flight and lie flatter in the water.
        const lean = player.isFlying ? .55 : player.isSwimming ? 1.1 : 0;
        avatar.root.rotation.x += (lean - avatar.root.rotation.x) * Math.min(1, dt * 8);
        if (player.isSwimming) avatar.root.position.y += .9;
        const striding = player.isGrounded && speed > .4;
        if (striding) this.walk += dt * (4 + speed * 1.3);
        const stride = striding ? Math.min(.75, .25 + speed * .06) : 0;
        const swim = player.isSwimming ? Math.sin(performance.now() * .006) * .6 : 0;
        avatar.legs.forEach((leg, n) => {
            const wanted = Math.sin(this.walk + n * Math.PI) * stride + (player.isGrounded ? 0 : .25 - n * .5) + swim * (n ? 1 : -1);
            leg.rotation.x += (wanted - leg.rotation.x) * Math.min(1, dt * 14);
        });
        // The right arm follows the same swing timing as the first-person tool.
        const effects = game.effects;
        const t = effects ? (performance.now() - effects.swingStart) / (effects.swingHeavy ? 420 : 300) : 1;
        const swing = t > 0 && t < 1 ? Math.sin(Math.min(1, t * 1.6) * Math.PI) : 0;
        avatar.arms.forEach((arm, n) => {
            let wanted = Math.sin(this.walk + (n ? 0 : Math.PI)) * stride * .8 - swim * (n ? 1 : -1);
            if (n === 1) wanted = this.heldKind ? -.55 - swing * 1.5 + wanted * .3 : wanted - swing * 1.6;
            if (n === 0 && this.torch?.isEnabled()) wanted = -1.15;
            arm.rotation.x += (wanted - arm.rotation.x) * Math.min(1, dt * 18);
        });
    }

    // --- Aiming without a first-person reticle ------------------------------
    candidates(reach) {
        const game = this.game, dungeon = game.dungeonSystem, eye = this.body.position;
        const underground = Boolean(dungeon?.active);
        const list = [];
        for (const animal of game.animalSystem?.animals || []) {
            if (!animal.mesh || Boolean(animal.dungeon) !== underground) continue;
            const spot = animal.mesh.position, def = CREATURES[animal.kind] || {};
            if (Math.abs(spot.y - (eye.y - EYE_HEIGHT)) > 4.5) continue;
            if (underground && !lineOfSight(dungeon.layout, eye.x, eye.z, spot.x, spot.z)) continue;
            list.push({x: spot.x, z: spot.z, radius: def.radius || .6, bias: def.brain ? 1.6 : .8, mesh: animal.mesh,
                point: new BABYLON.Vector3(spot.x, spot.y + 1, spot.z), ring: (def.radius || .6) * 2 + .9});
        }
        if (!underground) for (const node of game.inventorySystem?.harvestableObjects || []) {
            const spot = node.mesh?.position;
            if (!spot || Math.hypot(spot.x - eye.x, spot.z - eye.z) > reach + 1) continue;
            list.push({x: spot.x, z: spot.z, radius: node.type === 'tree' || node.type === 'rock' ? .6 : .2, bias: 0, mesh: node.mesh,
                point: new BABYLON.Vector3(spot.x, spot.y + .8, spot.z), ring: node.type === 'tree' ? 2.2 : 1.6});
        }
        return list;
    }

    coneHit(reach) {
        const eye = this.body.position;
        const found = coneTarget({x: eye.x, z: eye.z}, this.body.rotation.y, this.candidates(reach), reach);
        if (!found) return null;
        return {hit: true, pickedMesh: found.mesh, pickedPoint: found.point, assisted: true,
            distance: Math.hypot(found.x - eye.x, found.z - eye.z), ring: found.ring, x: found.x, z: found.z};
    }

    // What the player is aiming at. Third person aims with the centre of the
    // screen; overhead (and a third-person miss) takes whatever is in front.
    pick(reach) {
        if (this.mode === 'third') {
            const hit = this.scene.pickWithRay(this.camera.getForwardRay(reach + this.zoom.third + 4));
            if (hit?.hit && hit.pickedPoint) {
                const eye = this.body.position, yaw = this.body.rotation.y;
                const dx = hit.pickedPoint.x - eye.x, dz = hit.pickedPoint.z - eye.z;
                const ahead = dx * Math.sin(yaw) + dz * Math.cos(yaw) > -.3;
                if (ahead && BABYLON.Vector3.Distance(eye, hit.pickedPoint) <= reach + .8) return hit;
            }
        }
        return this.coneHit(reach) || {hit: false};
    }

    // Called every frame after the player has been simulated.
    update(dt) {
        if (this.firstPerson) return;
        // The body camera is no longer the active one, so the engine will not
        // advance it: apply this frame's look and movement input here.
        this.body.update();
        if (this.mode === 'overhead') this.body.rotation.x = 0; // Pitch means nothing from above.
        this.place();
        this.animate(dt);
        // A ring under whatever a swing would hit, since there is no reticle from above.
        this.targetTimer -= dt;
        if (this.targetTimer <= 0) {
            this.targetTimer = .1;
            const hit = this.mode === 'overhead' ? this.coneHit(this.game.combatSystem.reach()) : null;
            this.target = hit;
            this.marker.setEnabled(Boolean(hit));
            if (hit) {
                const dungeon = this.game.dungeonSystem;
                const ground = dungeon?.active ? dungeon.floorY : this.game.terrainSystem.getPerlinHeight(hit.x, hit.z);
                this.marker.position.set(hit.x, ground + .12, hit.z);
                this.marker.scaling.setAll(hit.ring / 1.7);
            }
        }
    }
}
