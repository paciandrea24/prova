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
        gravel: 0xC9B896,       // beige sabbia delle vie di fuga
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

    // ── Giorno e notte ────────────────────────────────────────────────
    //
    // Un circuito si corre di giorno o in notturno, e la scelta e' sua: sta
    // nel suo file (campo `notturno`, si mette dal track editor) e vale
    // uguale per la qualifica e per la gara.
    //
    // COME si fa notte, qui, e' una decisione presa contro la tentazione
    // ovvia. La tentazione era abbassare le luci. Non si puo': il cel
    // shading aggancia la luce a tre fasce fisse (BANDS) e la somma delle
    // intensita' deve restare intorno a 1 — sotto, le fasce si schiacciano
    // e ogni superficie diventa una macchia piatta. E' lo stesso difetto,
    // al contrario, gia' misurato il 2026-08-10 con la somma a 1.9.
    //
    // Quindi la notte si fa sul COLORE delle superfici, non sulla luce: la
    // stessa quantita' di luce cade su materiali scuri e freddi. Le fasce
    // restano dove sono, il disegno del cel shading resta leggibile, e a
    // scurire e' il mondo — che e' quello che succede davvero.
    const ORARI = {
        giorno: {
            // Una COPIA, non SKY_STOPS stesso: impostaOrario riscrive quello
            // in posto, e un riferimento condiviso si svuoterebbe da solo al
            // primo passaggio al notturno.
            skyStops: SKY_STOPS.map((t) => ({ t: t.t, color: t.color })),
            fogDensity: FOG_DENSITY,
            // Moltiplicatore sul colore delle superfici: di giorno, nessuno.
            tinta: 0xffffff,
            tintaPista: 0xffffff,
            tintaTerreno: 0xffffff,
            guadagno: 1,
            guadagnoPista: 1,
            hemi: { cielo: 0x9ec8f0, terra: 0x3f7a52, intensita: 0.30 },
            // Nessuna `elevazione`: di giorno l'inclinazione resta quella
            // scritta nella posizione della luce in f1.js, invariata.
            sole: { colore: 0xfff6e2, intensita: 0.72, elevazione: null },
        },
        notte: {
            // Quattro tappe come di giorno (la cupola compila lo shader su
            // quel numero: cambiarlo vorrebbe dire ricompilare, non
            // aggiornare). L'orizzonte NON e' nero: e' il blu sporco del
            // cielo sopra uno stadio acceso, ed e' anche il colore della
            // nebbia — su un orizzonte nero il circuito lontano sparirebbe
            // in un muro invece di sfumare.
            // Il primo giro era GRIGIO, non nero, «come se ci fosse
            // nebbia» (playtest 2026-08-18). Due cause, e la seconda è
            // quella che contava: l'orizzonte era 0x39456b, cioè luma
            // 0.27 — e l'orizzonte È ANCHE il colore della nebbia, per
            // costruzione (vedi fogColor). Quindi ogni cosa lontana non
            // spariva nel buio: sbiadiva verso quel grigio-azzurro.
            // Secondo giro, dopo «non è nero notte» (playtest 2026-08-18).
            // Lo zenit è praticamente nero (luma 0.010) e l'orizzonte
            // conserva solo un accenno del bagliore che sale dalle torri
            // faro — quel poco serve alla nebbia, che PRENDE questo colore:
            // a zero, il circuito lontano finirebbe di colpo contro un muro
            // invece di sfumare.
            skyStops: [
                // Neutro e non blu: questo colore è anche quello della
                // nebbia (fogColor === skyColorAt(0)), quindi tingeva di
                // azzurro tutto ciò che era lontano - l'ultima dominante da
                // chiaro di luna rimasta in scena.
                { t: 0.00, color: 0x14161e },
                { t: 0.06, color: 0x0a1020 },
                { t: 0.30, color: 0x050813 },
                { t: 1.00, color: 0x01020a },
            ],
            // Più densa del giorno, ma il velo lattiginoso del primo giro
            // dipendeva dal COLORE chiaro della nebbia, non dalla quantità.
            // Ora che l'orizzonte è quasi nero (luma 0.085) la densità è
            // proprio ciò che fa sparire il fondo NEL NERO mentre la pista
            // sotto l'auto resta illuminata: è il punto che vende il
            // notturno tenendo tutto visibile.
            fogDensity: 0.0018,
            // Il colore che moltiplica ogni superficie. TERZA stesura, e le
            // prime due sbagliavano di impostazione, non di taratura:
            // facevano «notte = tutto scuro» (questa tinta stava a luma
            // 0.28) e sono state bocciate tre volte, ogni volta con
            // «schiarisci un po' di più».
            //
            // Una gara in notturno vera è tutto ILLUMINATO sotto un cielo
            // NERO: a dire «è notte» sono il cielo, le sorgenti accese e il
            // fondo che sparisce nel nero — non la luminosità delle
            // superfici. E un'ombra ha bisogno di luce per esistere:
            // scurendo tutto si spengono anche le ombre, che era il difetto
            // più grave delle prime due stesure.
            //
            // Quindi ora la tinta non scurisce quasi più: RAFFREDDA. Il
            // prato passa da 0.51 di giorno a ~0.42 di notte, cioè resta
            // ben visibile. Vedi
            // docs/superpowers/specs/2026-08-18-f1-notturno-illuminazione-design.md
            // QUARTA taratura, dopo «sembra che c'è la luce della luna ad
            // illuminare, niente di più» (playtest 2026-08-18).
            //
            // Il difetto era il BLU. Era 0xc6d2ea, con l'azzurro il 18% più
            // forte del rosso — e una dominante azzurra è esattamente il
            // codice visivo del chiaro di luna. Un proiettore da stadio è
            // bianco: metallo-alogenuri o LED intorno ai 5000 K, che a
            // schermo si legge neutro, appena freddo. Non azzurro.
            //
            // E sale ancora: luma 0.92 contro 0.82. Il prato arriva a 0.47
            // contro lo 0.51 che ha di giorno — cioè il mondo è illuminato
            // quanto di giorno. È quello che vuol dire «circuito
            // completamente illuminato artificialmente»: a dire che è notte
            // restano il cielo nero, il fondo che sparisce e le lampade
            // accese, non la penombra.
            tinta: 0xe8ecf2,
            // …ma non tutto è al buio allo stesso modo, ed è questa riga a
            // fare la differenza fra «una scena scura» e «una gara in
            // notturno»: l'asfalto, i cordoli e la ghiaia stanno sotto le
            // torri faro, e restano QUASI chiari. È il nastro luminoso che
            // taglia il buio — la cosa che si riconosce in una foto di
            // Singapore prima ancora di capire cosa si sta guardando.
            //
            // Costa zero: è una uniform per materiale, non una luce.
            tintaPista: 0xf2f5fb,

            // ── I due guadagni ──────────────────────────────────────
            //
            // Un colore esadecimale non può superare 0xffffff, cioè 1.0:
            // come moltiplicatore può solo SCURIRE. Ed è il muro contro cui
            // si è fermato il primo tentativo di illuminare la pista.
            //
            // L'asfalto parte da 0x5e6b75, luma 0.41 — un grigio medio.
            // Anche con la tinta a bianco pieno resterebbe a 0.41, che a
            // schermo è scuro: «l'illuminazione è ancora troppo scarsa»
            // (playtest 2026-08-18) non era una questione di quale grigio
            // scegliere, era che nessun grigio poteva bastare.
            //
            // Il guadagno rompe quel tetto: la tinta viene moltiplicata per
            // un numero che può stare sopra 1, e THREE.Color regge
            // componenti maggiori di uno senza batter ciglio. Con 2.2
            // l'asfalto illuminato arriva a ~0.79 di luma — un nastro
            // bianco sotto le torri faro, non un grigio un po' meno grigio.
            //
            // Perché non si perde il cel shading: le tre fasce moltiplicano
            // DOPO, quindi restano 0.36 / 0.57 / 0.79 — tre livelli ben
            // separati. Con un guadagno molto più alto si schiaccerebbero
            // contro il tetto del bianco, ed è lo stesso difetto delle luci
            // troppo forti descritto in cima a questo blocco.
            guadagno: 1,
            // 1.63 e non più 2.2: l'illuminazione è UNIFORME su tutto il
            // circuito (richiesta esplicita dell'utente), quindi l'asfalto
            // non è più un nastro chiaro dentro il buio. Resta comunque il
            // punto più illuminato — è la superficie su cui le torri faro
            // sono puntate — e arriva a ~0.60 di luma contro lo 0.41 che ha
            // di giorno: di notte l'asfalto è più chiaro che di giorno.
            guadagnoPista: 1.73,

            // Il terreno e la vegetazione hanno una tinta LORO, più scura.
            //
            // Guardando le foto di Singapore: l'asfalto è la cosa più chiara
            // dell'inquadratura, il prato e le palme ai lati sono nettamente
            // più scuri, e le strutture (barriere, reti, tribune) stanno in
            // mezzo. Non è illuminazione uniforme al millimetro: è che i
            // proiettori sono puntati SULLA PISTA, e il verde attorno prende
            // solo quel che avanza.
            //
            // Il prato passa da 0.34 di notte contro lo 0.68 dell'asfalto,
            // cioè metà. Resta ben visibile — non si torna al buio delle
            // prime stesure — ma smette di competere con la pista.
            //
            // Vale solo per terreno e vegetazione: barriere, tribune, auto e
            // costruzioni tengono `tinta`, altrimenti si spegnerebbe tutto
            // di nuovo.
            tintaTerreno: 0xa3aab6,
            // La luce d'ambiente era un blu profondo: sotto uno stadio
            // acceso non esiste: la luce rimbalza da tribune, asfalto e
            // strutture, e le ombre restano riempite invece di andare al
            // nero. Grigio neutro, quindi, e più chiaro.
            hemi: { cielo: 0x9aa2b4, terra: 0x4a4e58, intensita: 0.30 },
            // Bianco freddo da torre faro al posto del bianco caldo del
            // sole. Stessa intensita': vedi sopra il perche'.
            //
            // `elevazione` in gradi: una torre faro illumina da trenta metri
            // sopra la pista, non di taglio come un sole di pomeriggio. A
            // 60.8 gradi (il valore del giorno) l'ombra di un oggetto alto 1
            // è lunga 0.56; a 78 gradi scende a 0.21 — corta e appiccicata
            // sotto l'auto, che è una delle cose che si riconoscono subito
            // in una gara notturna.
            // Bianco, non azzurro: 0xdde7ff aveva 34 punti di azzurro in
            // più del rosso e tingeva di luna tutto quello che toccava.
            //
            // L'elevazione scende da 78 a 74 gradi. A 78 le facce
            // VERTICALI - le barriere - stavano quasi a 90 gradi dalla
            // luce, che è la condizione peggiore per una mappa d'ombra:
            // da lì i triangoli che si muovevano sulle barriere
            // (segnalati in playtest). Il resto lo fa normalBias in
            // f1.js. L'ombra resta corta: 0.29 contro lo 0.21 di prima e
            // lo 0.56 del giorno.
            sole: { colore: 0xfbfaff, intensita: 0.72, elevazione: 74 },
        },
    };

    let orarioCorrente = 'giorno';

    // Cambia l'ora del giorno. Va chiamata PRIMA di costruire la scena:
    // cielo e luci leggono questi valori una volta sola, quando nascono.
    function impostaOrario(nome) {
        if (!ORARI[nome]) throw new Error(`Orario sconosciuto: "${nome}"`);
        orarioCorrente = nome;
        // SKY_STOPS e' un array esportato per riferimento: chi lo ha gia' in
        // mano deve vedere il cambio, quindi si riscrive in posto e non si
        // sostituisce.
        SKY_STOPS.length = 0;
        for (const s of ORARI[nome].skyStops) SKY_STOPS.push(s);
        return ORARI[nome];
    }

    function orario() { return ORARI[orarioCorrente]; }
    function eNotte() { return orarioCorrente === 'notte'; }
    function fogDensity() { return orario().fogDensity; }

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

    // NOTA STORICA (2026-08-10). Qui è vissuta per poche ore una tabella di
    // rimappatura colore-per-colore, con i selettori nel pannello, usata per
    // TARARE dal vivo le tinte neutre degli asset invece di rigenerarli a
    // ogni tentativo. Approvati i valori, sono stati scritti in
    // `backend/tools/voxelKit.py` e i 25 asset rigenerati: da allora i colori
    // arrivano dai GLB e la rimappatura è stata rimossa, perché due fonti per
    // lo stesso colore divergono al primo che ne tocca una sola.
    // Se un giorno servisse ritarare, la strada è la stessa: rimettere la
    // rimappatura come strumento temporaneo, non come sede dei colori.

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
        ORARI, impostaOrario, orario, eNotte, fogDensity,
        skyColorAt, fogColor, saturate, hexToRgb, rgbToHex,
    };
});
