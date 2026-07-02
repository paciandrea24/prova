'use strict';
// frontend/gamepad.js — Supporto controller (Gamepad API)
// Espone GamepadInput (globale); caricato prima di fps.js.

const GamepadInput = (() => {

    // ── Mappatura predefinita (layout Xbox / PS standard) ──────────────────
    const DEFAULT_MAP = {
        moveH:  { type: 'axis',   index: 0 }, // Stick sin. X  (neg=sx, pos=dx)
        moveV:  { type: 'axis',   index: 1 }, // Stick sin. Y  (neg=avanti, pos=indietro)
        lookH:  { type: 'axis',   index: 2 }, // Stick des. X
        lookV:  { type: 'axis',   index: 3 }, // Stick des. Y
        fire:   { type: 'button', index: 7 }, // RT  / R2
        ads:    { type: 'button', index: 6 }, // LT  / L2
        jump:   { type: 'button', index: 0 }, // A   / Cross
        sprint: { type: 'button', index: 4 }, // LB  / L1
        crouch: { type: 'button', index: 1 }, // B   / Circle
        reload: { type: 'button', index: 2 }, // X   / Square
    };

    const DEADZONE = 0.12;
    let lookSens = 2.5;   // rad/s per unità di asse (regolabile dalla UI)

    let map       = _loadMap();
    let connected = false;
    let gpIdx     = null;
    let prev      = {};        // stato frame precedente (edge detection)
    let autoFireTimer = null;
    let panelOpen = false;

    // Stato movimento continuo (letto da fps.js via getState())
    let mvState = { moveX: 0, moveY: 0, crouch: false, sprint: false };

    // Callbacks registrate da fps.js tramite setCallbacks()
    let cbs = {};

    // ── Persistenza localStorage ────────────────────────────────────────────
    function _loadMap() {
        try {
            const s = localStorage.getItem('fps_gp_map');
            if (s) return Object.assign({}, DEFAULT_MAP, JSON.parse(s));
        } catch {}
        return Object.assign({}, DEFAULT_MAP);
    }

    function _saveMap() {
        localStorage.setItem('fps_gp_map', JSON.stringify(map));
    }

    function _loadSens() {
        const v = parseFloat(localStorage.getItem('fps_gp_sens'));
        if (!isNaN(v) && v > 0) lookSens = v;
    }
    _loadSens();

    function _saveSens(v) {
        lookSens = v;
        localStorage.setItem('fps_gp_sens', String(v));
    }

    // ── Notifica HUD (creata dinamicamente) ────────────────────────────────
    function _notify(msg) {
        let el = document.getElementById('gp-notify');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('active');
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('active'), 2800);
    }

    // ── Rilevamento connessione ─────────────────────────────────────────────
    window.addEventListener('gamepadconnected', (e) => {
        connected = true;
        gpIdx = e.gamepad.index;
        prev = {};
        _notify('Controller connesso');
        _refreshStatus();
    });

    window.addEventListener('gamepaddisconnected', (e) => {
        if (e.gamepad.index !== gpIdx) return;
        connected = false;
        gpIdx = null;
        mvState = { moveX: 0, moveY: 0, crouch: false, sprint: false };
        if (autoFireTimer) { clearInterval(autoFireTimer); autoFireTimer = null; }
        if (cbs.onADSRelease) cbs.onADSRelease();
        _notify('Controller disconnesso');
        _refreshStatus();
    });

    // ── Helper input ────────────────────────────────────────────────────────
    function _dead(v) { return Math.abs(v) > DEADZONE ? v : 0; }

    function _axisOf(gp, entry) {
        if (entry.type === 'axis') return _dead(gp.axes[entry.index] || 0);
        return (gp.buttons[entry.index] || { value: 0 }).value;
    }

    function _pressed(gp, entry) {
        if (entry.type === 'axis') return Math.abs(_axisOf(gp, entry)) > 0.5;
        return (gp.buttons[entry.index] || { pressed: false }).pressed;
    }

    function _edgeKey(action) {
        return `${action}_${map[action].type}_${map[action].index}`;
    }

    // ── Poll principale — da chiamare ogni frame in animate() ───────────────
    function poll(dt) {
        if (panelOpen || !connected) return { lookX: 0, lookY: 0, jumpPressed: false };

        const gps = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp  = gps[gpIdx];
        if (!gp) return { lookX: 0, lookY: 0, jumpPressed: false };

        // Movimento (lo legge fps.js via getState())
        mvState.moveX  = _axisOf(gp, map.moveH);
        mvState.moveY  = _axisOf(gp, map.moveV);
        mvState.crouch = _pressed(gp, map.crouch);
        mvState.sprint = _pressed(gp, map.sprint);

        // Mira — ritorna valori raw scalati; fps.js applica il fattore ADS
        const lookX = _axisOf(gp, map.lookH) * lookSens * dt;
        const lookY = _axisOf(gp, map.lookV) * lookSens * dt;

        // Jump (rising edge)
        const jumpNow = _pressed(gp, map.jump);
        const jk = _edgeKey('jump');
        const jumpPressed = jumpNow && !prev[jk];
        prev[jk] = jumpNow;

        // Reload (rising edge)
        const reloadNow = _pressed(gp, map.reload);
        const rk = _edgeKey('reload');
        if (reloadNow && !prev[rk] && cbs.onReload) cbs.onReload();
        prev[rk] = reloadNow;

        // ADS (rising / falling edge)
        const adsNow = _pressed(gp, map.ads);
        const ak = _edgeKey('ads');
        if (adsNow  && !prev[ak] && cbs.onADS)       cbs.onADS();
        if (!adsNow &&  prev[ak] && cbs.onADSRelease) cbs.onADSRelease();
        prev[ak] = adsNow;

        // Fire + auto-fire
        const fireNow = _pressed(gp, map.fire);
        const fk = _edgeKey('fire');
        if (fireNow && !prev[fk]) {
            if (cbs.onFire) cbs.onFire();
            const w = cbs.getWeapon ? cbs.getWeapon() : null;
            if (w && w.auto) {
                clearInterval(autoFireTimer);
                autoFireTimer = setInterval(() => { if (cbs.onFire) cbs.onFire(); }, w.fireRate);
            }
        }
        if (!fireNow && prev[fk]) {
            clearInterval(autoFireTimer);
            autoFireTimer = null;
        }
        prev[fk] = fireNow;

        // Tasto Start / Menu (button 9) → apri/chiudi pannello
        const startNow = (gp.buttons[9] || { pressed: false }).pressed;
        if (startNow && !prev['_start']) togglePanel();
        prev['_start'] = startNow;

        return { lookX, lookY, jumpPressed };
    }

    function getState()        { return mvState; }
    function setCallbacks(cb)  { cbs = cb; }
    function isPanelOpen()     { return panelOpen; }

    // ── Pannello mappatura ──────────────────────────────────────────────────
    const ACTION_DEFS = [
        { key: 'moveH',  label: 'Muovi sinistra / destra' },
        { key: 'moveV',  label: 'Muovi avanti / indietro' },
        { key: 'lookH',  label: 'Mira sinistra / destra'  },
        { key: 'lookV',  label: 'Mira su / giù'           },
        { key: 'fire',   label: 'Spara'                   },
        { key: 'ads',    label: 'ADS / Punta'             },
        { key: 'jump',   label: 'Salta'                   },
        { key: 'sprint', label: 'Corri'                   },
        { key: 'crouch', label: 'Accovacciati / Slide'    },
        { key: 'reload', label: 'Ricarica'                },
    ];

    let _listenKey   = null;
    let _listenTimer = null;
    let _listenBase  = null;

    function _bindLabel(entry) {
        if (!entry) return '—';
        return entry.type === 'axis' ? `Asse ${entry.index}` : `Tasto ${entry.index}`;
    }

    function _render() {
        const list = document.getElementById('gp-action-list');
        if (!list) return;
        list.innerHTML = '';
        for (const def of ACTION_DEFS) {
            const row = document.createElement('div');
            row.className = 'gp-row';

            const lbl = document.createElement('span');
            lbl.className = 'gp-row-label';
            lbl.textContent = def.label;

            const bind = document.createElement('span');
            bind.className = 'gp-row-bind';
            bind.textContent = _bindLabel(map[def.key]);

            const btn = document.createElement('button');
            btn.className = 'gp-rebind-btn';
            btn.dataset.action = def.key;
            btn.textContent = 'Riassegna';
            btn.addEventListener('click', () => _startListen(def.key));

            row.append(lbl, bind, btn);
            list.appendChild(row);
        }
    }

    function _startListen(actionKey) {
        if (!connected) { _notify('Collega un controller prima'); return; }
        if (_listenKey) _stopListen();

        _listenKey = actionKey;
        const rebindBtn = document.querySelector(`.gp-rebind-btn[data-action="${actionKey}"]`);
        if (rebindBtn) { rebindBtn.textContent = 'Premi un tasto…'; rebindBtn.classList.add('listening'); }

        const gp = (navigator.getGamepads ? navigator.getGamepads() : [])[gpIdx];
        if (!gp) { _stopListen(); return; }

        _listenBase = {
            axes: Array.from(gp.axes),
            btns: gp.buttons.map(b => b.value)
        };

        _listenTimer = setInterval(() => {
            const cur = (navigator.getGamepads ? navigator.getGamepads() : [])[gpIdx];
            if (!cur) { _stopListen(); return; }
            for (let i = 0; i < cur.buttons.length; i++) {
                if (cur.buttons[i].value > 0.5 && _listenBase.btns[i] < 0.5) {
                    map[_listenKey] = { type: 'button', index: i };
                    _saveMap();
                    _stopListen();
                    return;
                }
            }
            for (let i = 0; i < cur.axes.length; i++) {
                if (Math.abs(cur.axes[i] - _listenBase.axes[i]) > 0.5) {
                    map[_listenKey] = { type: 'axis', index: i };
                    _saveMap();
                    _stopListen();
                    return;
                }
            }
        }, 50);
    }

    function _stopListen() {
        clearInterval(_listenTimer);
        _listenTimer = null;
        _listenKey   = null;
        _listenBase  = null;
        _render();
    }

    function _refreshStatus() {
        const el = document.getElementById('gp-status');
        if (!el) return;
        el.textContent = connected ? 'Controller rilevato' : 'Nessun controller';
        el.className   = 'gp-status ' + (connected ? 'ok' : 'ko');
    }

    function openPanel() {
        if (panelOpen) return;
        panelOpen = true;
        document.getElementById('gp-panel').classList.add('visible');
        _render();
        _refreshStatus();
        if (document.pointerLockElement) document.exitPointerLock();
        clearInterval(autoFireTimer); autoFireTimer = null;
        if (cbs.onADSRelease) cbs.onADSRelease();
    }

    function closePanel() {
        if (!panelOpen) return;
        panelOpen = false;
        _stopListen();
        document.getElementById('gp-panel').classList.remove('visible');
        if (cbs.onPanelClose) cbs.onPanelClose();
    }

    function togglePanel() {
        panelOpen ? closePanel() : openPanel();
    }

    function resetMap() {
        map = Object.assign({}, DEFAULT_MAP);
        _saveMap();
        _render();
    }

    // ── Init DOM (defer garantisce DOM pronto) ──────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        // Crea elemento notifica
        const notify = document.createElement('div');
        notify.id = 'gp-notify';
        document.body.appendChild(notify);

        // Slider sensibilità
        const slider = document.getElementById('gp-sens-slider');
        const valEl  = document.getElementById('gp-sens-val');
        if (slider) {
            slider.value = lookSens;
            if (valEl) valEl.textContent = lookSens.toFixed(1);
            slider.addEventListener('input', () => {
                const v = parseFloat(slider.value);
                _saveSens(v);
                if (valEl) valEl.textContent = v.toFixed(1);
            });
        }

        document.getElementById('gp-close-btn').addEventListener('click', closePanel);
        document.getElementById('gp-reset-btn').addEventListener('click', resetMap);
    });

    return { poll, getState, setCallbacks, isPanelOpen, openPanel, closePanel, togglePanel };
})();
