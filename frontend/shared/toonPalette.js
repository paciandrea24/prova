// frontend/shared/toonPalette.js
//
// Palette e regole di correzione del colore per il look cel-shaded del gioco
// F1 (Rif. spec 2026-08-10-f1-art-direction-cel-shading-design.md).
//
// Modulo PURO: nessuna dipendenza da Three.js, quindi è l'unico pezzo del
// motore di stile verificabile con `node --test`. Tutto ciò che qui è un
// numero deve restare un numero: appena un valore ha bisogno di una texture
// o di un materiale, il suo posto è in toonStyle.js.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonPalette = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    function hexToRgb(hex) {
        return {
            r: ((hex >> 16) & 255) / 255,
            g: ((hex >> 8) & 255) / 255,
            b: (hex & 255) / 255,
        };
    }

    function rgbToHex(rgb) {
        const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
        return (q(rgb.r) << 16) | (q(rgb.g) << 8) | q(rgb.b);
    }

    // Colori delle superfici che il gioco genera in JavaScript (non arrivano
    // da un GLB, quindi non basterebbe correggerli nello shader: qui il
    // colore è scritto nel codice ed è giusto cambiarlo alla fonte).
    //
    // L'asfalto è il salto più grosso: da 0x1e1e1e, quasi nero, a un grigio
    // medio bluastro. Non è un vezzo — su un asfalto nero le fasce di luce
    // non hanno spazio per vedersi e l'ombra colorata non ha nulla su cui
    // virare.
    const SURFACES = {
        grass: 0x3fa86b,        // era 0x3d8b3d
        grassDark: 0x2e8f5e,    // chiazza scura del prato dipinto
        grassLight: 0x55be7c,   // chiazza chiara
        asphalt: 0x5e6b75,      // era 0x1e1e1e
        pitLane: 0x6a7681,      // era 0x3a3a3a
        bridge: 0x8b93a0,       // era 0x4a4a4a
        pond: 0x1e63c8,         // era 0x2f6fa8
        curbNeutral: [0.55, 0.57, 0.60],  // era [0.35, 0.35, 0.37] (vertex color)
    };

    // Gradiente del cielo, dall'orizzonte (t=0) allo zenit (t=1).
    //
    // Quattro tappe e non tre: la banda calda crema-pesca sta APPENA SOPRA
    // l'orizzonte, mentre la tappa più bassa — quella che tocca la linea del
    // terreno, e che quindi diventa il colore della nebbia — è un azzurro
    // pallido virato al lilla. Da lì vengono le colline lontane color lilla
    // del riferimento. Mettendo il crema-pesca proprio sull'orizzonte le
    // colline virerebbero al beige.
    // Valori scelti dall'utente con gli slider del pannello (2026-08-10).
    //
    // L'orizzonte è CALDO (0xeed5b3), non più azzurro-lilla: era la scelta di
    // partenza, ma il salto fra la foschia fredda e la banda arancione subito
    // sopra si vedeva e non convinceva. Scaldando l'orizzonte, il terreno
    // lontano sfuma DENTRO la banda calda invece di scontrarcisi. Conseguenza
    // voluta: le colline all'orizzonte virano al beige caldo e non al lilla.
    //
    // La banda calda è ora bassa e stretta (0.05, azzurro già da 0.26): sale
    // poco e lascia il cielo all'azzurro.
    const SKY_STOPS = [
        { t: 0.00, color: 0xeed5b3 },
        { t: 0.05, color: 0xffd49a },
        { t: 0.26, color: 0x8fd3f0 },
        { t: 1.00, color: 0x3fa9e8 },
    ];

    const FOG_DENSITY = 0.001;

    function skyColorAt(t) {
        const x = Math.max(0, Math.min(1, t));
        for (let i = 1; i < SKY_STOPS.length; i++) {
            const a = SKY_STOPS[i - 1], b = SKY_STOPS[i];
            if (x <= b.t) {
                const k = b.t === a.t ? 0 : (x - a.t) / (b.t - a.t);
                // smoothstep invece di lineare: agli attacchi fra due tappe
                // una rampa lineare lascia uno spigolo di luminosità che in
                // cielo si legge come banda.
                const s = k * k * (3 - 2 * k);
                const ca = hexToRgb(a.color), cb = hexToRgb(b.color);
                return rgbToHex({
                    r: ca.r + (cb.r - ca.r) * s,
                    g: ca.g + (cb.g - ca.g) * s,
                    b: ca.b + (cb.b - ca.b) * s,
                });
            }
        }
        return SKY_STOPS[SKY_STOPS.length - 1].color;
    }

    // La nebbia NON è un colore indipendente: è il cielo alla quota
    // dell'orizzonte. Definirla così rende impossibile per costruzione la
    // riga di stacco fra prato e cielo.
    function fogColor() {
        return skyColorAt(0);
    }

    // Tinta verso cui vira la fascia in ombra, invece di scurire in grigio:
    // nel riferimento l'ombra sul muro rosso è rosso scuro, non grigia.
    const SHADOW_TINT = 0x8aa0c8;

    // Le tre fasce del cel shading: valori di irradianza a cui la luce viene
    // agganciata. La più scura non è 0 — a zero le zone in ombra propria
    // diventerebbero nere e perderebbero il colore della superficie.
    const BANDS = [0.45, 0.72, 1.0];

    // Quanta saturazione aggiungere, per famiglia di oggetti. Sull'auto è
    // quasi nulla: il colore identifica il pilota ed è lo stesso pallino
    // della classifica.
    const SATURATION = { scenery: 0.18, world: 0.10, car: 0.04 };

    // Allontana il colore dal proprio luma senza ruotare la tinta: un rosso
    // resta rosso, diventa solo più squillante. amount 0 = identità.
    function saturate(hex, amount) {
        if (!amount) return hex;
        const c = hexToRgb(hex);
        const luma = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        return rgbToHex({
            r: luma + (c.r - luma) * (1 + amount),
            g: luma + (c.g - luma) * (1 + amount),
            b: luma + (c.b - luma) * (1 + amount),
        });
    }

    return {
        SURFACES, SKY_STOPS, FOG_DENSITY, SHADOW_TINT, BANDS, SATURATION,
        skyColorAt, fogColor, saturate, hexToRgb, rgbToHex,
    };
});
