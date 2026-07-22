/**
 * Unified input: touch (virtual joystick + drag-look + buttons) and
 * keyboard/mouse fallback for desktop testing.
 */
export class Controls {
  constructor({ onAttack, onInteract }) {
    this.move = { x: 0, y: 0 };      // -1..1, y+ = forward
    this.look = { dx: 0, dy: 0 };    // consumed each frame
    this.sprint = false;
    this.onAttack = onAttack;
    this.onInteract = onInteract;

    this._joyId = null;
    this._joyCenter = { x: 0, y: 0 };
    this._lookId = null;
    this._lookLast = { x: 0, y: 0 };

    this._keys = {};
    this._bindTouch();
    this._bindButtons();
    this._bindKeyboard();
  }

  _el(id) { return document.getElementById(id); }

  _bindTouch() {
    const joy = this._el('joystick');
    const knob = this._el('joystick-knob');
    const maxR = 46;

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    const resetKnob = () => { knob.style.transform = 'translate(-50%,-50%)'; };

    joy.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this._joyId = t.identifier;
      const r = joy.getBoundingClientRect();
      this._joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      e.preventDefault();
    }, { passive: false });

    const joyMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._joyId) continue;
        let dx = t.clientX - this._joyCenter.x;
        let dy = t.clientY - this._joyCenter.y;
        const d = Math.hypot(dx, dy);
        if (d > maxR) { dx = dx / d * maxR; dy = dy / d * maxR; }
        setKnob(dx, dy);
        this.move.x = dx / maxR;
        this.move.y = -dy / maxR;   // up = forward
        e.preventDefault();
      }
    };
    joy.addEventListener('touchmove', joyMove, { passive: false });

    const joyEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyId) {
          this._joyId = null; this.move.x = 0; this.move.y = 0; resetKnob();
        }
      }
    };
    joy.addEventListener('touchend', joyEnd);
    joy.addEventListener('touchcancel', joyEnd);

    // Camera look: drag anywhere on the canvas region (right side dominant)
    const canvas = this._el('game-canvas');
    canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (this._lookId === null) {
        this._lookId = t.identifier;
        this._lookLast = { x: t.clientX, y: t.clientY };
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._lookId) continue;
        this.look.dx += t.clientX - this._lookLast.x;
        this.look.dy += t.clientY - this._lookLast.y;
        this._lookLast = { x: t.clientX, y: t.clientY };
      }
    }, { passive: true });
    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookId) this._lookId = null;
      }
    };
    canvas.addEventListener('touchend', lookEnd);
    canvas.addEventListener('touchcancel', lookEnd);
  }

  _bindButtons() {
    const attack = this._el('btn-attack');
    const sprint = this._el('btn-sprint');
    const interact = this._el('btn-interact');

    const press = (el, fn) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
      el.addEventListener('mousedown', (e) => { e.preventDefault(); fn(); });
    };

    press(attack, () => this.onAttack && this.onAttack());
    press(interact, () => this.onInteract && this.onInteract());

    const setSprint = (v) => { this.sprint = v; sprint.classList.toggle('active', v); };
    sprint.addEventListener('touchstart', (e) => { e.preventDefault(); setSprint(true); }, { passive: false });
    sprint.addEventListener('touchend', () => setSprint(false));
    sprint.addEventListener('touchcancel', () => setSprint(false));
    sprint.addEventListener('mousedown', () => setSprint(true));
    sprint.addEventListener('mouseup', () => setSprint(false));
    sprint.addEventListener('mouseleave', () => setSprint(false));
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this._keys[e.code] = true;
      if (e.code === 'Space') { e.preventDefault(); this.onAttack && this.onAttack(); }
      if (e.code === 'KeyE' || e.code === 'KeyF') this.onInteract && this.onInteract();
      if (e.code === 'ShiftLeft') this.sprint = true;
    });
    window.addEventListener('keyup', (e) => {
      this._keys[e.code] = false;
      if (e.code === 'ShiftLeft') this.sprint = false;
    });

    // Mouse drag look on desktop
    const canvas = this._el('game-canvas');
    let dragging = false, last = { x: 0, y: 0 };
    canvas.addEventListener('mousedown', (e) => { dragging = true; last = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this.look.dx += e.clientX - last.x;
      this.look.dy += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  /** Fold keyboard WASD/arrows into the move vector. Call once per frame. */
  pollKeyboard() {
    let kx = 0, ky = 0;
    if (this._keys['KeyW'] || this._keys['ArrowUp']) ky += 1;
    if (this._keys['KeyS'] || this._keys['ArrowDown']) ky -= 1;
    if (this._keys['KeyA'] || this._keys['ArrowLeft']) kx -= 1;
    if (this._keys['KeyD'] || this._keys['ArrowRight']) kx += 1;
    if (kx !== 0 || ky !== 0) {
      const d = Math.hypot(kx, ky);
      this.move.x = kx / d; this.move.y = ky / d;
    } else if (this._joyId === null) {
      // leave joystick-driven values alone; only zero if no touch active
    }
  }

  consumeLook() {
    const l = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0; this.look.dy = 0;
    return l;
  }
}
