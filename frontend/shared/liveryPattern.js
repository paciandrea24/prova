// frontend/shared/liveryPattern.js
//
// Porting diretto di computeBodyColors()/isBody()/computeBase()/
// applyLivery() da voxel_livery_studio.html (editor esterno di
// riferimento, non nel repo — vedi [[project_f1_livery_ingame_port]]).
// Opera sul modello voxel prodotto da frontend/shared/voxelizer.js (M:
// un cella-per-voxel con colore originale/lock/lat/len/up + una mesh a
// facce indipendenti, 4 vertici tutti suoi per faccia) — MAI sulla mesh
// originale scolpita a mano: dipingere quest'ultima direttamente (tentativo
// di questa stessa sessione, poi abbandonato) sbava inevitabilmente sulle
// superfici curve, perché i vertici sono condivisi tra facce vicine e un
// singolo triangolo può avere i suoi angoli su due lati diversi di un
// confine di pattern. Con la mesh voxel del Voxelizer questo non può
// succedere per costruzione: ogni faccia riceve UN SOLO colore, scritto
// una volta su tutti i suoi 4 vertici.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LiveryPattern = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // Luminosita' minima (come frazione della luminosita' del colore
    // scelto) che un voxel puo' assumere per via dell'ombra/AO originale —
    // evita che il blend moltiplicativo scenda mai a luminosita' zero
    // (nero puro) su colori target scuri.
    const SHADE_FLOOR = 0.22;

    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }


    // Colori dominanti (per capire cos'e' carrozzeria e cos'e' dettaglio):
    // istogramma dei colori quantizzati (4 bit/canale) tra i voxel NON
    // "locked" (gomme/parti nere, vedi voxelizer.js), bucket piu' frequente.
    function computeBodyColors(M) {
        const hist = new Map();
        for (let q = 0; q < M.n; q++) {
            if (M.locked[q]) continue;
            const r = Math.round(M.orig[q * 3] * 15), g = Math.round(M.orig[q * 3 + 1] * 15), b = Math.round(M.orig[q * 3 + 2] * 15);
            const k = (r * 16 + g) * 16 + b;
            hist.set(k, (hist.get(k) || 0) + 1);
        }
        const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);
        const total = [...hist.values()].reduce((a, b) => a + b, 0) || 1;

        if (sorted.length > 0) {
            const domKey = sorted[0][0];
            const dB = domKey % 16, dG = Math.floor(domKey / 16) % 16, dR = Math.floor(domKey / 256);
            const domColor = new THREE.Color(dR / 15, dG / 15, dB / 15);

            // ASSICURATI CHE NON CI SIA NESSUN domColor.convertLinearToSRGB() QUI!

            M.domHSL = { h: 0, s: 0, l: 0 };
            domColor.getHSL(M.domHSL);
        } else {
            M.domHSL = { h: 0, s: 0, l: 0.5 };
        }

        const body = new Set();
        let acc = 0;
        for (const [k, c] of sorted) {
            body.add(k); acc += c;
            if (acc / total > 0.55 || body.size >= 4) break;
        }
        M.bodyKeys = body;
    }
    function isBody(M, q) {
        if (!M.bodyKeys) return true;
        const r = Math.round(M.orig[q * 3] * 15), g = Math.round(M.orig[q * 3 + 1] * 15), b = Math.round(M.orig[q * 3 + 2] * 15);
        return M.bodyKeys.has((r * 16 + g) * 16 + b);
    }

    // Colore-livrea per ogni voxel (prima dell'ombreggiatura/trasferimento
    // saturazione, applicati in applyLivery). Stesso set di pattern
    // dell'editor di riferimento.
    function computeBase(M, params) {
        // Nota r128 (three.js su questo progetto, non 0.160 come l'editor
        // di riferimento): niente color-management esplicito, i valori hex
        // sono usati così come sono — stessa convenzione già seguita da
        // carLoader.js altrove nel progetto.
        const cPrimary = new THREE.Color(params.primary).convertSRGBToLinear();
        const cSecondary = new THREE.Color(params.secondary).convertSRGBToLinear();
        const cAccent = new THREE.Color(params.accent).convertSRGBToLinear();

        const latC = (M.spanLat - 1) / 2;
        const wStripe = Math.max(1, Math.round(M.spanLat * 0.11));
        const wSplit = Math.max(1, Math.round(M.spanLat * 0.30));
        const rnd = mulberry32(M.n * 7 + 13);
        const noise = [];
        for (let i = 0; i < 24; i++) noise.push(rnd());

        if (!M.base) M.base = new Float32Array(M.n * 3);

        for (let q = 0; q < M.n; q++) {
            let r, g, b;
            const keep = params.keepDetails ? (M.locked[q] || !isBody(M, q)) : M.locked[q];
            if (keep) {
                r = M.orig[q * 3]; g = M.orig[q * 3 + 1]; b = M.orig[q * 3 + 2];
            } else {
                const dLat = Math.abs(M.lat[q] - latC);
                const L = M.nLen[q], U = M.nUp[q], X = M.nLat[q];
                let col = cPrimary, t = -1;

                switch (params.pattern) {
                    case 'racing_stripes':
                        if (dLat <= wStripe) col = cSecondary;
                        else if (dLat <= wStripe + 1) col = cAccent;
                        break;
                    case 'split_sides':
                        if (dLat >= wSplit) col = cSecondary;
                        else if (dLat >= wSplit - 1) col = cAccent;
                        break;
                    case 'gradient':
                        t = clamp((L - 0.15) / 0.7, 0, 1);
                        break;
                    case 'halves': {
                        const mid = Math.round(M.spanLen * 0.52);
                        if (M.len[q] > mid) col = cSecondary;
                        else if (M.len[q] > mid - 1) col = cAccent;
                        break;
                    }
                    case 'diagonal': {
                        const per = Math.max(4, Math.round(M.spanLen * 0.13));
                        const ph = ((M.len[q] + M.lat[q] * 2 + M.up[q]) % per + per) % per;
                        if (ph < per * 0.45) col = cSecondary;
                        else if (ph < per * 0.45 + 1) col = cAccent;
                        break;
                    }
                    case 'abstract': {
                        const s = Math.sin(L * 9.0 + noise[0] * 6.28) + Math.sin(X * 11.0 + noise[1] * 6.28) * 0.8
                            + Math.sin(U * 7.0 + noise[2] * 6.28) * 0.6;
                        col = s > 0.15 ? cSecondary : (s < -0.6 ? cAccent : cPrimary);
                        break;
                    }
                    case 'top_deck': {
                        const lim = Math.round(M.spanUp * 0.58);
                        if (M.up[q] > lim) col = cSecondary;
                        else if (M.up[q] > lim - 1) col = cAccent;
                        break;
                    }
                    case 'tricolor': {
                        const p1 = Math.round(M.spanLen * 0.33);
                        const p2 = Math.round(M.spanLen * 0.66);
                        if (M.len[q] > p2) col = cSecondary;
                        else if (M.len[q] > p1) col = cAccent;
                        break;
                    }
                    case 'checkers': {
                        const size = Math.max(2, Math.round(M.spanLat * 0.15));
                        const cx = Math.floor(M.lat[q] / size);
                        const cl = Math.floor(M.len[q] / size);
                        const cu = Math.floor(M.up[q] / size);
                        if ((cx + cl + cu) % 2 === 0) col = cSecondary;
                        break;
                    }
                    case 'camo': {
                        const n1 = Math.sin(X * 18.0 + noise[3] * 10) * Math.cos(L * 15.0 + noise[4] * 10) + Math.sin(U * 12.0 + noise[5] * 10);
                        if (n1 > 0.6) col = cSecondary;
                        else if (n1 < -0.6) col = cAccent;
                        break;
                    }
                    case 'waves': {
                        const wave = Math.sin(L * 15.0 + noise[6] * 6.28) * 0.25;
                        if (U > 0.5 + wave) col = cSecondary;
                        else if (U > 0.4 + wave) col = cAccent;
                        break;
                    }
                    case 'pinstripe': {
                        const step = Math.max(3, Math.round(M.spanLat * 0.12));
                        if (dLat % step === 0 && dLat !== 0) col = cSecondary;
                        break;
                    }
                    case 'flames': {
                        const jagged = Math.sin(X * 25.0 + noise[7] * 10) * 0.15 + Math.cos(U * 20.0 + noise[8] * 5) * 0.1;
                        if (L < 0.25 + jagged) col = cSecondary;
                        else if (L < 0.32 + jagged) col = cAccent;
                        break;
                    }
                    case 'tiger': {
                        const stripe = Math.sin(L * 35.0 + Math.sin(U * 12.0) * 1.5 + noise[9] * 5);
                        if (stripe > 0.65) col = cSecondary;
                        else if (stripe > 0.45) col = cAccent;
                        break;
                    }
                    case 'digital_rain': {
                        const rain = Math.sin(X * 45.0) * Math.sin(L * 50.0 + U * 8.0 + noise[10] * 20);
                        if (rain > 0.85) col = cSecondary;
                        else if (rain > 0.65) col = cAccent;
                        break;
                    }
                    case 'patchwork': {
                        const blockX = Math.floor(M.lat[q] / 6);
                        const blockL = Math.floor(M.len[q] / 9);
                        const blockU = Math.floor(M.up[q] / 5);
                        const randVal = Math.sin(blockX * 12.33 + blockL * 45.66 + blockU * 78.99 + noise[11]) * 10000;
                        const dec = randVal - Math.floor(randVal);
                        if (dec > 0.7) col = cSecondary;
                        else if (dec > 0.4) col = cAccent;
                        break;
                    }
                    case 'speed_lines': {
                        const row = Math.floor(M.up[q] / 2);
                        const rowOffset = Math.sin(row * 4.7 + noise[12] * 10) * 15.0;
                        const streak = Math.cos(L * 20.0 + rowOffset);
                        if (streak > 0.8 - (L * 0.6) && row % 2 === 0) col = cSecondary;
                        else if (streak > 0.95 - (L * 0.5) && row % 3 === 0) col = cAccent;
                        break;
                    }
                    // === STILI REALISTICI F1 ===
                    case 'aero_skirt': {
                        // Riscritto (v2): la prima riscrittura era ancora
                        // troppo minimale (fascia sottile, il secondary
                        // restava comunque appena visibile). Ora una fascia
                        // bassa VERA e propria in secondary (non un filo) —
                        // abbastanza larga da restare visibile anche se le
                        // righe più basse in assoluto sono "locked" (scure/
                        // gomma, escluse dal pattern) — con un filo accent
                        // netto esattamente al bordo superiore, a marcare la
                        // linea di separazione dal resto della carrozzeria.
                        // Soglie in RIGHE VOXEL reali (M.up/M.spanUp), mai
                        // frazionarie: Math.max(...) garantisce sempre
                        // almeno qualche riga anche a bassa risoluzione.
                        const skirtTop = Math.max(3, Math.round(M.spanUp * 0.22));
                        const trimRows = Math.max(1, Math.round(M.spanUp * 0.04));
                        if (M.up[q] <= skirtTop - trimRows) col = cSecondary;
                        else if (M.up[q] <= skirtTop) col = cAccent;
                        break;
                    }
                    case 'sidepod_sweep': {
                        // Taglio diagonale sulle pance laterali
                        // Se i voxel sono molto esterni (fiancate) e sotto la linea diagonale
                        if (Math.abs(X) > 0.15 && U < (1.1 - L * 1.5)) col = cSecondary;
                        break;
                    }
                    case 'nose_arrow': {
                        // Freccia colorata che segue la larghezza del musetto anteriore
                        const arrowWidth = L * 0.8;
                        if (Math.abs(X) < arrowWidth && L < 0.55) col = cSecondary;
                        else if (Math.abs(X) < arrowWidth + 0.05 && L < 0.58) col = cAccent;
                        break;
                    }
                    case 'airbox_fin': {
                        // Cofano motore e airbox a contrasto (es. Haas, McLaren)
                        if (U > 0.45 && L > 0.35) col = cSecondary;
                        if (U > 0.5 && L > 0.45 && Math.abs(X) < 0.05) col = cAccent;
                        break;
                    }
                    case 'dynamic_slashes': {
                        // Tagli dritti obliqui lungo tutta la carrozzeria
                        const slash = L + U * 0.6;
                        if (slash > 0.6 && slash < 0.75) col = cSecondary;
                        else if (slash > 0.8 && slash < 0.85) col = cAccent;
                        else if (slash > 0.95 && slash < 1.15) col = cSecondary;
                        break;
                    }

                    // === STILI SCI-FI / VOXEL ART ===
                    case 'dither': {
                        // Sfumatura "a gradini" tipica della pixel art
                        const isEven = (M.lat[q] + M.len[q] + M.up[q]) % 2 === 0;
                        if (L > 0.6) col = cSecondary;
                        else if (L > 0.4 && isEven) col = cSecondary;
                        else if (L > 0.2 && !isEven && Math.abs(X) > 0.2) col = cAccent;
                        break;
                    }
                    case 'chevron': {
                        // Frecce convergenti in stile sci-fi
                        const wave = (L + Math.abs(X) * 1.5) * 6.0;
                        if (wave % 1.0 < 0.25) col = cSecondary;
                        else if (wave % 1.0 < 0.35) col = cAccent;
                        break;
                    }
                    case 'honeycomb': {
                        // Struttura finto nido d'ape / fibra di carbonio
                        const hx = M.lat[q] % 5;
                        const hl = M.len[q] % 5;
                        const hu = M.up[q] % 5;
                        if ((hx === 0 || hl === 0 || hu === 0) && (hx + hl + hu) > 2) col = cAccent;
                        else if (hx === 1 || hl === 1) col = cSecondary;
                        break;
                    }
                    case 'shatter': {
                        // Tagli geometrici irregolari incrociati
                        const shatterVal = Math.sin(X * 40.0) * Math.cos(L * 30.0) + Math.sin(U * 20.0);
                        if (Math.abs(shatterVal) < 0.15) col = cAccent;
                        else if (shatterVal > 0.8) col = cSecondary;
                        break;
                    }
                    case 'circuit': {
                        // Strisce elettroniche ad angoli retti (90°)
                        const cx = M.lat[q] % 10;
                        const cl = M.len[q] % 10;
                        const cu = M.up[q] % 10;
                        if (cx === 0 && cl > 2) col = cAccent;
                        else if (cl === 0 && cu > 2) col = cSecondary;
                        else if (cx === 2 && cu === 2) col = cAccent;
                        break;
                    }
                    case 'wireframe': {
                        // Evidenzia solo i bordi estremi della macchina in
                        // stile "Tron". Niente più accent (l'angolo dove
                        // scattava, larghezza massima E cima/fondo insieme,
                        // conteneva solo un paio di voxel reali, un dettaglio
                        // invisibile/inutile) — resta un pattern a 2 colori.
                        const edgeX = Math.abs(X) > 0.42;
                        const edgeU = U > 0.85 || U < 0.15;
                        if (edgeX || edgeU) col = cSecondary;
                        break;
                    }
                    default:
                        break; // 'solid' e altri non gestiti restano cPrimary
                }
                if (t >= 0) {
                    r = cPrimary.r + (cSecondary.r - cPrimary.r) * t;
                    g = cPrimary.g + (cSecondary.g - cPrimary.g) * t;
                    b = cPrimary.b + (cSecondary.b - cPrimary.b) * t;
                } else {
                    r = col.r; g = col.g; b = col.b;
                }
            }
            M.base[q * 3] = r; M.base[q * 3 + 1] = g; M.base[q * 3 + 2] = b;
        }
    }

    // Scrive i colori definitivi nella geometria voxel: ombreggiatura
    // (trasferimento moltiplicativo dell'AO originale, mai a zero) +
    // trasferimento saturazione (un voxel originale smorto/desaturato
    // smorza anche il colore-pattern scelto). Stesso identico principio
    // dell'editor di riferimento — un solo colore per FACCIA, scritto sui
    // suoi 4 vertici (mai condivisi con la faccia vicina): zero sbavature.
    function applyLivery(M, params) {
        computeBodyColors(M);
        computeBase(M, params);

        const col = M.geometry.attributes.color;
        const arr = col.array;

        for (let f = 0; f < M.faceCount; f++) {
            const q = M.faceCell[f];
            let r = M.base[q * 3], g = M.base[q * 3 + 1], b = M.base[q * 3 + 2];

            const keep = params.keepDetails ? (M.locked[q] || !isBody(M, q)) : M.locked[q];

            if (keep) {
                r = M.orig[q * 3]; g = M.orig[q * 3 + 1]; b = M.orig[q * 3 + 2];

                if (!params.showOriginal) {
                    const tempColor = new THREE.Color(r, g, b);

                    // Nessuna conversione qui! Usiamo il lineare puro come nella r160
                    const hsl = { h: 0, s: 0, l: 0 };
                    tempColor.getHSL(hsl);

                    let hueDist = Math.abs(hsl.h - M.domHSL.h);
                    if (hueDist > 0.5) hueDist = 1 - hueDist;

                    // Il fix delle ruote (hsl.s < 0.3) resta attivo e protegge il giallo!
                    if ((hsl.l < 0.28 && hsl.s < 0.3) || (hsl.l < 0.5 && hueDist < 0.08)) {
                        tempColor.setHSL(0, 0, hsl.l);
                        r = tempColor.r; g = tempColor.g; b = tempColor.b;
                    }
                }

            } else {
                const origColor = new THREE.Color(M.orig[q * 3], M.orig[q * 3 + 1], M.orig[q * 3 + 2]);
                const origHSL = { h: 0, s: 0, l: 0 };
                origColor.getHSL(origHSL);

                const targetColor = new THREE.Color(r, g, b);
                const targetHSL = { h: 0, s: 0, l: 0 };
                targetColor.getHSL(targetHSL);

                // Grazie ai valori Lineari, relShade ora potrà superare l'1.0
                // e creare le sfumature chiare sul naso dell'auto!
                const relShade = origHSL.l / Math.max(M.domHSL.l, 0.02);
                const shadeMult = Math.max(SHADE_FLOOR, relShade);
                const finalL = Math.max(0, Math.min(1, targetHSL.l * shadeMult));

                let finalS = targetHSL.s;
                if (origHSL.s < 0.25) finalS = targetHSL.s * (origHSL.s / 0.25);

                targetColor.setHSL(targetHSL.h, finalS, finalL);
                r = targetColor.r; g = targetColor.g; b = targetColor.b;
            }

            const o = f * 12;
            for (let v = 0; v < 4; v++) {
                arr[o + v * 3] = r; arr[o + v * 3 + 1] = g; arr[o + v * 3 + 2] = b;
            }
        }
        col.needsUpdate = true;
    }

    return { applyLivery };
});
