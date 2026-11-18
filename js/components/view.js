// First-person, third-person and overhead views. The original first-person
// camera stays the player's "body": it still takes all movement and look
// input and every system still reads its position. In the other views a
// second camera does the looking and the body is drawn as an avatar.
import { VIEW_LABELS, ZOOM, isView, nextView, clampZoom, cameraRig, clampRig, coneTarget } from '../view.js';
import { cellOf, isOpen, lineOfSight } from '../dungeon.js';
import { createAvatarModel } from '../models/avatar.js';
import { AVATAR, avatarPose, gait, ease } from '../avatar.js';
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
        this.gait = {phase: 0, stride: 0, speed: 0, turn: 0, forward: 0, right: 0};
        this.clock = 0;
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
                // Gripped a third of the way up the haft; the pose tilts the hand, not the tool.
                if (kind === 'spear') { mesh.scaling.setAll(.62); mesh.position.set(0, 0, .2); }
                else { mesh.scaling.setAll(.62); mesh.position.set(0, .15, 0); }
                this.held = mesh;
            }
        }
        const lit = Boolean(!this.firstPerson && effects?.torchLit);
        if (lit && !this.torch) {
            this.torch = createTorchModel(this.scene);
            this.torch.parent = this.avatar.leftHand;
            this.torch.isPickable = false;
            this.torch.scaling.setAll(.7);
            this.torch.position.set(0, .17, 0);
            this.torch.material.emissiveColor = new BABYLON.Color3(.5, .32, .14);
        }
        this.torch?.setEnabled(lit);
    }

    animate(dt) {
        const game = this.game, player = game.playerSystem, body = this.body, avatar = this.avatar;
        const step = Math.max(dt, .001), yaw = body.rotation.y, sin = Math.sin(yaw), cos = Math.cos(yaw);
        // A jump of more than a few metres in one frame is a teleport (stairs, respawn), not a sprint.
        let dx = body.position.x - this.last.x, dz = body.position.z - this.last.z;
        if (Math.hypot(dx, dz) > 4) dx = dz = 0;
        this.last.x = body.position.x; this.last.z = body.position.z;
        const cap = value => Math.max(-14, Math.min(14, value / step));
        this.gait = gait(this.gait, cap(dx * sin + dz * cos), cap(dx * cos - dz * sin), dt, Boolean(player.isGrounded) && !player.isSwimming && !player.isFlying);
        this.clock += dt;
        avatar.root.position.set(body.position.x, body.position.y - EYE_HEIGHT, body.position.z);
        avatar.root.rotation.y = yaw;
        // Lean into flight and lie flatter in the water.
        const lean = player.isFlying ? .55 : player.isSwimming ? 1.1 : 0;
        avatar.root.rotation.x = ease(avatar.root.rotation.x, lean, 8, dt);
        if (player.isSwimming) avatar.root.position.y += .9;
        // The right arm follows the same swing timing as the first-person tool.
        const effects = game.effects, archery = game.archery;
        const attack = effects?.swingStart ? (performance.now() - effects.swingStart) / (effects.swingHeavy ? 420 : 300) / 1.25 : 1;
        const pose = avatarPose({
            ...this.gait, time: this.clock, grounded: Boolean(player.isGrounded), swimming: Boolean(player.isSwimming), flying: Boolean(player.isFlying),
            dodging: (player.dodgeLeft || 0) > 0, attack: attack >= 0 && attack < 1 ? attack : null, heavy: Boolean(effects?.swingHeavy),
            held: this.heldKind, torch: Boolean(this.torch?.isEnabled()), draw: archery?.drawing ? archery.amount() : null, look: body.rotation.x
        });
        // Both hands are on the bow while it is drawn, so what they carried is put away.
        this.held?.setEnabled(!archery?.drawing);
        if (this.torch && archery?.drawing) this.torch.setEnabled(false);
        else if (this.torch && !this.firstPerson) this.torch.setEnabled(Boolean(effects?.torchLit));
        this.applyPose(pose, dt);
    }

    // Ease every joint toward the pose. A swing or a drawn bow moves faster than a stroll.
    applyPose(pose, dt) {
        const avatar = this.avatar, quick = 26, calm = 16;
        const to = (node, axis, value, rate = calm) => { node.rotation[axis] = ease(node.rotation[axis], value, rate, dt); };
        avatar.hips.position.y = ease(avatar.hips.position.y, AVATAR.hips + pose.hipsY, calm, dt);
        to(avatar.hips, 'y', pose.hipsYaw, 10);
        to(avatar.torso, 'x', pose.torsoPitch); to(avatar.torso, 'y', pose.torsoYaw, quick);
        to(avatar.head, 'x', pose.headPitch, 12); to(avatar.head, 'y', pose.headYaw, 12);
        avatar.legs.forEach((leg, n) => { to(leg.hip, 'x', pose.legs[n].hip, quick); to(leg.knee, 'x', pose.legs[n].knee, quick); });
        avatar.arms.forEach((arm, n) => {
            const wanted = pose.arms[n];
            to(arm.shoulder, 'x', wanted.shoulder, quick); to(arm.elbow, 'x', wanted.elbow, quick);
            to(arm.shoulder, 'z', wanted.spread * arm.side, calm);
            // A carried thing keeps its own tilt whatever the arm is doing.
            arm.hand.rotation.x = wanted.hand === null ? ease(arm.hand.rotation.x, 0, calm, dt) : wanted.hand - arm.shoulder.rotation.x - arm.elbow.rotation.x;
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
