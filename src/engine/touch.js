// Responsive Virtual Thumbstick + ABXY Gamepad Diamond for Touch Devices.
// Automatically hidden when `?touch=0` is passed (e.g., Steam Deck Kiosk Mode)
// or on desktop browsers without touch unless `?touch=1` is requested.

export function setupTouchControls(container, input, params) {
  const touchParam = params.get('touch');
  const forceOff = touchParam === '0';
  const forceOn = touchParam === '1';
  const hasTouch =
    forceOn ||
    (!forceOff &&
      (('ontouchstart' in window) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 0)));

  if (!container) return { enabled: false, updateMode() {} };
  if (!hasTouch) {
    container.classList.add('hidden');
    return { enabled: false, updateMode() {} };
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="touch-stick-zone" id="touch-stick-zone">
      <div class="touch-stick-base">
        <div class="touch-stick-nub" id="touch-stick-nub"></div>
      </div>
    </div>
    <div class="touch-diamond">
      <button class="tbtn tbtn-y" data-act="btnY"><span>Y</span><small id="tlbl-y">Ball</small></button>
      <button class="tbtn tbtn-x" data-act="btnX"><span>X</span><small id="tlbl-x">Berry</small></button>
      <button class="tbtn tbtn-b" data-act="btnB"><span>B</span><small id="tlbl-b">Dash</small></button>
      <button class="tbtn tbtn-a" data-act="btnA"><span>A</span><small id="tlbl-a">Act</small></button>
      <button class="tbtn tbtn-rb" data-act="btnRB"><span>RB</span><small id="tlbl-rb">Special</small></button>
      <button class="tbtn tbtn-lb" data-act="btnLB"><span>LB</span><small id="tlbl-lb">Catch</small></button>
    </div>
  `;

  const stickZone = container.querySelector('#touch-stick-zone');
  const nub = container.querySelector('#touch-stick-nub');
  let stickId = null;
  let originX = 0;
  let originY = 0;
  const maxR = 46;

  stickZone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stickZone.setPointerCapture(e.pointerId);
    stickId = e.pointerId;
    const rect = stickZone.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    moveNub(e.clientX, e.clientY);
  });

  const moveNub = (cx, cy) => {
    let dx = cx - originX;
    let dy = cy - originY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    nub.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    input.setTouchStick(dx / maxR, dy / maxR);
  };

  stickZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    moveNub(e.clientX, e.clientY);
  });

  const releaseStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    nub.style.transform = 'translate(0px, 0px)';
    input.setTouchStick(0, 0);
  };
  stickZone.addEventListener('pointerup', releaseStick);
  stickZone.addEventListener('pointercancel', releaseStick);

  for (const btn of container.querySelectorAll('[data-act]')) {
    const act = btn.getAttribute('data-act');
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('pressed');
      input.setTouchAction(act, true);
    });
    const up = () => {
      btn.classList.remove('pressed');
      input.setTouchAction(act, false);
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  }

  return {
    enabled: true,
    updateMode(inBattle) {
      const setLbl = (id, txt) => {
        const el = container.querySelector('#' + id);
        if (el && el.textContent !== txt) el.textContent = txt;
      };
      if (inBattle) {
        setLbl('tlbl-a', 'Select');
        setLbl('tlbl-b', 'Back');
        setLbl('tlbl-x', 'Berry');
        setLbl('tlbl-y', 'Catch');
        setLbl('tlbl-rb', 'Fight');
        setLbl('tlbl-lb', 'Switch');
      } else {
        setLbl('tlbl-a', 'Act');
        setLbl('tlbl-b', 'Sprint');
        setLbl('tlbl-x', 'Berry');
        setLbl('tlbl-y', 'Aim Ball');
        setLbl('tlbl-rb', 'Battle');
        setLbl('tlbl-lb', 'Menu');
      }
    },
  };
}
