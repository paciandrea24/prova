'use strict';
// frontend/f1Gamepad.js — Supporto controller per F1 (Gamepad API)
// Espone F1GamepadInput (globale); caricato prima di f1.js.
// Mappatura fissa in stile PlayStation (stick sx = sterzo, R2/L2 = gas/freno,
// X = conferma/reazione pit, Triangolo = cambio camera, D-pad sx/dx =
// navigazione schede mescola, L1 = pannello gomme, R1 = riparazione danni ai
// box). Nessun pannello di rimappatura: se servirà si aggiunge in seguito.

const F1GamepadInput = (() => {

    const AXIS_STEER    = 0;   // Stick sinistro, asse X
    const BTN_THROTTLE  = 7;   // R2 (grilletto destro)
    const BTN_BRAKE     = 6;   // L2 (grilletto sinistro)
    const BTN_CONFIRM   = 0;   // X / Cross — reazione pit O conferma mescola (dipende dalla fase)
    const BTN_CAMERA    = 3;   // Triangolo / Y
    const BTN_TYRE_TOGGLE = 4;   // L1 — apri/chiudi il pannello gomme (mappatura standard Gamepad API: index 4 = LB/L1)
    const BTN_REPAIR_TOGGLE = 5;   // R1 — spunta/togli la riparazione danni ai box (simmetrico a L1), index 5 = RB/R1
    const BTN_DPAD_LEFT  = 14;
    const BTN_DPAD_RIGHT = 15;

    const DEADZONE = 0.12;

    let connected = false;
    let gpIdx     = null;
    let prevConfirm = false;
    let prevCamera  = false;
    let prevDpadL   = false;
    let prevDpadR   = false;
    let prevTyre    = false;
    let prevRepair  = false;
    let cbs = {};

    window.addEventListener('gamepadconnected', (e) => {
        connected = true;
        gpIdx = e.gamepad.index;
        prevConfirm = prevCamera = prevDpadL = prevDpadR = prevTyre = prevRepair = false;
    });

    window.addEventListener('gamepaddisconnected', (e) => {
        if (e.gamepad.index !== gpIdx) return;
        connected = false;
        gpIdx = null;
    });

    // Curva dolce al centro: risposta attenuata vicino al centro, piena a
    // fondo corsa — standard nei giochi di guida per correzioni fini ad alta
    // velocità senza nervosismo dello sterzo.
    function _steerCurve(v) {
        return Math.sign(v) * Math.pow(Math.abs(v), 1.5);
    }

    function _dead(v) { return Math.abs(v) > DEADZONE ? v : 0; }

    function setCallbacks(cb) { cbs = cb; }

    function poll() {
        if (!connected) return { connected: false, throttle: 0, brake: 0, steer: 0 };

        const gps = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp  = gps[gpIdx];
        if (!gp) return { connected: false, throttle: 0, brake: 0, steer: 0 };

        // Asse positivo = stick spinto a destra; il segno va invertito
        // perché nella convenzione server "steer" positivo equivale al
        // tasto 'a' (sinistra), negativo al tasto 'd' (destra).
        const rawSteer = _dead(gp.axes[AXIS_STEER] || 0);
        const steer    = -_steerCurve(rawSteer);
        const throttle = (gp.buttons[BTN_THROTTLE] || { value: 0 }).value;
        const brake    = (gp.buttons[BTN_BRAKE]    || { value: 0 }).value;

        const confirmNow = (gp.buttons[BTN_CONFIRM] || { pressed: false }).pressed;
        if (confirmNow && !prevConfirm && cbs.onConfirm) cbs.onConfirm();
        prevConfirm = confirmNow;

        const cameraNow = (gp.buttons[BTN_CAMERA] || { pressed: false }).pressed;
        if (cameraNow && !prevCamera && cbs.onCameraToggle) cbs.onCameraToggle();
        prevCamera = cameraNow;

        const tyreNow = (gp.buttons[BTN_TYRE_TOGGLE] || { pressed: false }).pressed;
        if (tyreNow && !prevTyre && cbs.onTyreToggle) cbs.onTyreToggle();
        prevTyre = tyreNow;

        const repairNow = (gp.buttons[BTN_REPAIR_TOGGLE] || { pressed: false }).pressed;
        if (repairNow && !prevRepair && cbs.onRepairToggle) cbs.onRepairToggle();
        prevRepair = repairNow;

        const dpadLNow = (gp.buttons[BTN_DPAD_LEFT]  || { pressed: false }).pressed;
        if (dpadLNow && !prevDpadL && cbs.onNavLeft) cbs.onNavLeft();
        prevDpadL = dpadLNow;

        const dpadRNow = (gp.buttons[BTN_DPAD_RIGHT] || { pressed: false }).pressed;
        if (dpadRNow && !prevDpadR && cbs.onNavRight) cbs.onNavRight();
        prevDpadR = dpadRNow;

        return { connected: true, throttle, brake, steer };
    }

    function isConnected() { return connected; }

    return { poll, setCallbacks, isConnected };
})();
