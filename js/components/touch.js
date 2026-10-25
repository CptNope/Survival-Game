// Pointer-based mobile controls. Desktop keyboard/mouse remain unchanged.
// No virtual-gamepad dependency, rendering assets, or extra per-frame DOM writes.
export const TOUCH_DEAD_ZONE = 0.10;

export function joystickAxes(dx, dy, radius = 54) {
    const r = Math.max(1, radius);
    const length = Math.hypot(dx, dy);
    const scale = length > r ? r / length : 1;
    const x = dx * scale / r, y = dy * scale / r;
    if (Math.hypot(x, y) <= TOUCH_DEAD_ZONE) return {x: 0, y: 0};
    return {x, y};
}

export function applyTouchLook(camera, dx, dy, sensitivity = .0031) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    camera.rotation.y += dx * sensitivity;
    camera.rotation.x = Math.max(-1.45, Math.min(1.45, camera.rotation.x + dy * sensitivity));
}

export function applyJoystick(camera, axes, dtScale = 1) {
    if (!axes || (!axes.x && !axes.y)) return;
    const scale = Math.min(2.5, Math.max(0, dtScale));
    const speed = camera.speed * scale;
    const heading = camera.rotation.y;
    const rightX = Math.cos(heading), rightZ = -Math.sin(heading);
    const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
    // Babylon's cameraDirection uses WORLD-space movement. By adding to that
    // vector we keep the camera collision engine rather than teleporting.
    camera.cameraDirection.x += (rightX * axes.x - forwardX * axes.y) * speed;
    camera.cameraDirection.z += (rightZ * axes.x - forwardZ * axes.y) * speed;
}

export class TouchControls {
    constructor(game) {
        this.game = game;
        this.enabled = typeof window !== 'undefined' && (
            window.matchMedia?.('(any-pointer: coarse)').matches ||
            window.matchMedia?.('(pointer: coarse)').matches
        );
        this.axes = {x:0, y:0};
        this.movePointer = null;
        this.lookPointer = null;
        this.lastLook = null;
        this.controls = null;
        if (!this.enabled) return;

        const camera = game.playerSystem.camera;
        // Babylon's native touch inputs would double-apply camera movement.
        camera.inputs?.removeByType?.('FreeCameraTouchInput');
        if (camera.inputs?.attached?.mouse) camera.inputs.attached.mouse.touchEnabled = false;

        const root = document.createElement('div');
        root.id = 'touch-controls';
        root.setAttribute('aria-label', 'Touch game controls');
        root.innerHTML = [
            '<div id="touch-stick" class="touch-stick" aria-label="Movement joystick">',
            '  <span class="touch-stick-track"><span class="touch-stick-knob"></span></span>',
            '</div>',
            '<div class="touch-actions">',
            '  <button type="button" data-action="attack" aria-label="Gather or attack">HIT</button>',
            '  <button type="button" data-action="jump" aria-label="Jump or fly">JUMP</button>',
            '  <button type="button" data-action="sprint" aria-label="Hold to sprint">RUN</button>',
            '  <button type="button" data-action="drink" aria-label="Drink water">DRINK</button>',
            '  <button type="button" data-action="special" aria-label="Special attack">SKILL</button>',
            '  <button type="button" data-action="descend" aria-label="Descend while flying">DOWN</button>',
            '</div>'
        ].join('');
        document.getElementById('hud').append(root);
        this.controls = root;
        this.stick = root.querySelector('#touch-stick');
        this.knob = root.querySelector('.touch-stick-knob');
        this.bindJoystick();
        this.bindLook(game.engine.getRenderingCanvas());
        this.bindButtons();
        this.setPaused(game.paused);
    }

    bindJoystick() {
        this.stick.addEventListener('pointerdown', event => {
            if (this.game.paused || !event.isPrimary && this.movePointer !== null) return;
            if (this.movePointer !== null) return;
            event.preventDefault();
            this.movePointer = event.pointerId;
            this.stick.setPointerCapture?.(event.pointerId);
            this.moveStick(event);
        });
        this.stick.addEventListener('pointermove', event => {
            if (event.pointerId === this.movePointer) {
                event.preventDefault();
                this.moveStick(event);
            }
        });
        const release = event => {
            if (event.pointerId !== this.movePointer) return;
            this.movePointer = null;
            this.axes = {x:0,y:0};
            this.knob.style.transform = 'translate(0, 0)';
        };
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
            this.stick.addEventListener(type, release);
    }

    moveStick(event) {
        const bounds = this.stick.getBoundingClientRect();
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        const radius = Math.min(bounds.width, bounds.height) * .34;
        this.axes = joystickAxes(dx, dy, radius);
        this.knob.style.transform = 'translate(' + (this.axes.x * radius) + 'px, ' +
            (this.axes.y * radius) + 'px)';
    }

    bindLook(canvas) {
        canvas.addEventListener('pointerdown', event => {
            if (this.game.paused || event.pointerType !== 'touch' || this.lookPointer !== null) return;
            event.preventDefault();
            this.lookPointer = event.pointerId;
            this.lastLook = {x:event.clientX, y:event.clientY};
            canvas.setPointerCapture?.(event.pointerId);
        });
        canvas.addEventListener('pointermove', event => {
            if (this.game.paused || event.pointerId !== this.lookPointer || !this.lastLook) return;
            event.preventDefault();
            const dx = event.clientX - this.lastLook.x;
            const dy = event.clientY - this.lastLook.y;
            this.lastLook = {x:event.clientX, y:event.clientY};
            applyTouchLook(this.game.playerSystem.camera, dx, dy);
        });
        const release = event => {
            if (event.pointerId !== this.lookPointer) return;
            this.lookPointer = null;
            this.lastLook = null;
        };
        for (const type of ['pointerup','pointercancel','lostpointercapture'])
            canvas.addEventListener(type, release);
    }

    bindButtons() {
        const player = this.game.playerSystem;
        const action = name => {
            if (this.game.paused || player.isDead) return;
            if (name === 'attack') {
                this.game.inventorySystem.tryHarvest();
                this.game.combatSystem.tryAttack();
            } else if (name === 'special') {
                this.game.combatSystem.specialAttack();
            } else if (name === 'drink') {
                this.game.survivalSystem.drink();
            }
        };
        for (const button of this.controls.querySelectorAll('[data-action]')) {
            const name = button.dataset.action;
            let heldPointer = null;
            button.addEventListener('pointerdown', event => {
                if (this.game.paused || heldPointer !== null) return;
                event.preventDefault();
                heldPointer = event.pointerId;
                button.setPointerCapture?.(event.pointerId);
                button.classList.add('pressed');
                if (name === 'jump') {
                    player.keys.jump = true;
                    player.jump();
                } else if (name === 'sprint') player.keys.sprint = true;
                else if (name === 'descend') player.keys.descend = true;
                else action(name);
            });
            const release = event => {
                if (heldPointer !== event.pointerId) return;
                heldPointer = null;
                button.classList.remove('pressed');
                if (name === 'jump') player.keys.jump = false;
                else if (name === 'sprint') player.keys.sprint = false;
                else if (name === 'descend') player.keys.descend = false;
            };
            for (const type of ['pointerup','pointercancel','lostpointercapture'])
                button.addEventListener(type, release);
        }
    }

    setPaused(value) {
        if (!this.enabled) return;
        this.controls.hidden = !!value;
        if (value) this.reset();
    }

    reset() {
        this.axes = {x:0,y:0};
        this.movePointer = null;
        this.lookPointer = null;
        this.lastLook = null;
        if (this.knob) this.knob.style.transform = 'translate(0, 0)';
        const keys = this.game.playerSystem.keys;
        keys.jump = false;
        keys.sprint = false;
        keys.descend = false;
        if (this.controls) for (const button of this.controls.querySelectorAll('.pressed'))
            button.classList.remove('pressed');
    }

    update() {
        if (!this.enabled || this.game.paused || this.game.playerSystem.isDead) return;
        applyJoystick(this.game.playerSystem.camera, this.axes,
            this.game.scene.getAnimationRatio());
    }
}
