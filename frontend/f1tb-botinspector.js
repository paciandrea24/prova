// frontend/f1tb-botinspector.js
//
// Bot Inspector: pannello di debug IA del banco prova bot (Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-testbench-debug-design.md).
// Sola lettura/presentazione: riceve lo snapshot _botDebug già calcolato da
// updateBotInputs (backend/sockets/games/f1Bot.js), inoltrato via
// buildPublicState -> f1StateUpdate -> qui. Nessun ricalcolo, nessuna nuova
// logica IA — solo formattazione per la lettura umana.
//
// Ordine di lettura (approvato dall'utente, dominante -> dettaglio):
// 1. Stato (badge grande)  2. Decisione (speed/target/max)
// 3. Comandi (barre throttle/brake/steer)  4. Fattori limitanti (reason
// card, mostrate SOLO quando rilevanti — non un muro di numeri sempre acceso).
window.BotInspector = (function () {

    // Stesso fattore di conversione già usato dallo speedometer del gioco
    // vero (frontend/f1.js, speedEl.textContent) — non un nuovo valore
    // inventato qui, coerenza di unità tra i due strumenti.
    const KMH_FACTOR = 55;

    const STATE_STYLE = {
        CRUISE:           { label: 'CRUISE',            color: '#2ECC71' },
        BRAKE_FOR_CORNER: { label: 'BRAKE FOR CORNER',  color: '#E67E22' },
        FOLLOWING:        { label: 'FOLLOWING',          color: '#3498DB' },
        OVERTAKING:       { label: 'OVERTAKING',         color: '#9B59B6' },
        PIT_ENTRY:        { label: 'PIT ENTRY',          color: '#F1C40F' },
        PIT_LANE:         { label: 'PIT LANE',           color: '#F1C40F' },
        WAITING_START:    { label: 'WAITING START',      color: '#8b96a3' }
    };
    // Fallback per stati futuri non ancora mappati qui (nuove milestone IA,
    // vedi Punto 5 sotto): non deve mai sparire o rompersi, solo apparire
    // neutro finché non viene aggiunta una voce dedicata sopra.
    function stateStyle(state) {
        return STATE_STYLE[state] || { label: state || '—', color: '#8b96a3' };
    }

    // ============================================================
    // Punto 4/5 — Fattori limitanti come registro di "reason card"
    // ESTENDIBILE: ogni voce sa da sola se è rilevante (relevant) e come
    // presentarsi (render). Aggiungere un nuovo motivo decisionale in una
    // futura milestone (strategia, DRS, pit) è aggiungere UNA voce qui,
    // non toccare il layout del pannello.
    // ============================================================
    const REASON_CARDS = [
        {
            id: 'grip',
            relevant: (d) => d.gripCapacityFactor != null && Math.abs(d.gripCapacityFactor - 1) > 0.02,
            render: (d) => {
                const pct = Math.round(d.gripCapacityFactor * 100);
                const hint = d.gripCapacityFactor < 1 ? 'gomma/danno' : 'downforce';
                return { label: `Grip (${hint})`, value: `${pct}%` };
            }
        },
        {
            id: 'brakeDecel',
            // Rilevante solo quando il bot sta davvero frenando: è il
            // momento in cui "quanto può frenare" spiega la decisione,
            // altrimenti è un numero senza contesto per il resto del giro.
            relevant: (d) => d.state === 'BRAKE_FOR_CORNER' && d.brakeDecel != null,
            render: (d) => ({ label: 'Decelerazione frenata', value: d.brakeDecel.toFixed(3) })
        },
        {
            id: 'gapToAhead',
            relevant: (d) => (d.state === 'FOLLOWING' || d.state === 'OVERTAKING') && d.gapToAhead != null,
            render: (d) => ({ label: 'Distacco da auto avanti', value: `${d.gapToAhead.toFixed(1)}m` })
        }
    ];

    let cachedEls = null;
    function els() {
        if (cachedEls) return cachedEls;
        cachedEls = {
            panel:      document.getElementById('f1tb-inspector'),
            swatch:     document.getElementById('f1tb-insp-swatch'),
            state:      document.getElementById('f1tb-insp-state'),
            speed:      document.getElementById('f1tb-insp-speed'),
            targetSpeed:document.getElementById('f1tb-insp-targetspeed'),
            maxSpeed:   document.getElementById('f1tb-insp-maxspeed'),
            barThrottle:document.getElementById('f1tb-insp-bar-throttle'),
            barBrake:   document.getElementById('f1tb-insp-bar-brake'),
            barSteer:   document.getElementById('f1tb-insp-bar-steer'),
            distLine:   document.getElementById('f1tb-insp-distline'),
            headingDiff:document.getElementById('f1tb-insp-headingdiff'),
            reasons:    document.getElementById('f1tb-insp-reasons')
        };
        return cachedEls;
    }

    function fmtKmh(v) {
        return (v == null) ? '—' : `${Math.round(v * KMH_FACTOR)}`;
    }

    function setBar(el, value) {
        el.style.width = `${Math.max(0, Math.min(1, value ?? 0)) * 100}%`;
    }

    function setSteerBar(el, value) {
        const v = Math.max(-1, Math.min(1, value ?? 0));
        const halfPct = Math.abs(v) * 50;
        el.style.width = `${halfPct}%`;
        el.style.left = v >= 0 ? '50%' : `${50 - halfPct}%`;
    }

    function renderReasons(container, data) {
        container.innerHTML = '';
        for (const card of REASON_CARDS) {
            if (!card.relevant(data)) continue;
            const { label, value } = card.render(data);
            const row = document.createElement('div');
            row.className = 'f1tb-insp-reason-card';
            row.innerHTML = `<span class="f1tb-insp-reason-label">${label}</span><span class="f1tb-insp-reason-value">${value}</span>`;
            container.appendChild(row);
        }
    }

    // color: colore (hex) dell'auto seguita, per lo swatch. data: il
    // _botDebug ricevuto per quel colore nell'ultimo f1StateUpdate (può
    // essere null/undefined se non ancora arrivato o non un bot).
    function update(color, data) {
        const e = els();
        if (!color || !data) {
            e.panel.style.display = 'none';
            return;
        }
        e.panel.style.display = 'block';
        e.swatch.style.background = color;

        const style = stateStyle(data.state);
        e.state.textContent = style.label;
        e.state.style.color = style.color;
        e.state.style.background = style.color + '26';   // stesso colore, alpha basso, coerente col resto del pannello

        e.speed.textContent = fmtKmh(data.speed);
        e.targetSpeed.textContent = fmtKmh(data.targetSpeed);
        e.maxSpeed.textContent = fmtKmh(data.maxSpeed);
        // Target sotto la velocità reale = sta frenando; sopra = sta
        // spingendo — stessa lettura immediata delle barre comandi sotto.
        e.targetSpeed.style.color = (data.targetSpeed != null && data.speed != null)
            ? (data.targetSpeed < data.speed - 0.05 ? '#E74C3C' : (data.targetSpeed > data.speed + 0.05 ? '#2ECC71' : '#f2f4f6'))
            : '#f2f4f6';

        setBar(e.barThrottle, data.throttle);
        setBar(e.barBrake, data.brake);
        setSteerBar(e.barSteer, data.steer);

        // Traiettoria (Rif. audit 2026-07-29): quanto il bot si discosta
        // davvero dalla linea che dovrebbe seguire, non dedotto guardando lo
        // schermo — colore d'allarme solo oltre soglie chiaramente anomale,
        // stesso principio delle reason card (rumore visivo solo se serve).
        e.distLine.textContent = (data.distanceFromRacingLine == null) ? '—' : `${data.distanceFromRacingLine.toFixed(2)}m`;
        e.distLine.style.color = (data.distanceFromRacingLine != null && data.distanceFromRacingLine > 3) ? '#E74C3C' : '#f2f4f6';

        e.headingDiff.textContent = (data.headingVsTangentDeg == null) ? '—' : `${data.headingVsTangentDeg > 0 ? '+' : ''}${data.headingVsTangentDeg.toFixed(1)}°`;
        e.headingDiff.style.color = (data.headingVsTangentDeg != null && Math.abs(data.headingVsTangentDeg) > 20) ? '#E74C3C' : '#f2f4f6';

        renderReasons(e.reasons, data);
    }

    return { update };
})();
