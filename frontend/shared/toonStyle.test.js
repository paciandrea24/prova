const test = require('node:test');
const assert = require('node:assert/strict');
const ToonStyle = require('./toonStyle.js');

// Finto shader con i soli chunk a cui il patch si aggancia, negli stessi
// punti in cui compaiono in Three r128.
function fakeShader() {
    return {
        uniforms: {},
        vertexShader: [
            'void main() {',
            '    #include <beginnormal_vertex>',
            '    #include <begin_vertex>',
            '    #include <project_vertex>',
            '}',
        ].join('\n'),
        fragmentShader: [
            '#include <gradientmap_pars_fragment>',
            'void main() {',
            '    #include <map_fragment>',
            '    #include <color_fragment>',
            '    vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
            '}',
        ].join('\n'),
    };
}

test('il patch dichiara le sue uniform', () => {
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    for (const nome of ['uOn', 'uShadowTint', 'uSat', 'uIsGround']) {
        assert.ok(s.uniforms[nome], `manca la uniform ${nome}`);
    }
});

test('la saturazione è privata del materiale, non condivisa', () => {
    // Due materiali con saturazione diversa (scenografia 0.18, auto 0.04)
    // devono poter convivere: se uSat finisse fra le uniform condivise, il
    // secondo materiale sovrascriverebbe il primo e le auto verrebbero
    // saturate come la scenografia.
    const a = fakeShader(), b = fakeShader();
    ToonStyle.buildPatch(a, { saturation: 0.18, isGround: false });
    ToonStyle.buildPatch(b, { saturation: 0.04, isGround: false });
    assert.equal(a.uniforms.uSat.value, 0.18);
    assert.equal(b.uniforms.uSat.value, 0.04);
    assert.notEqual(a.uniforms.uSat, b.uniforms.uSat);
});

test('le uniform globali sono lo STESSO oggetto per tutti i materiali', () => {
    // È ciò che permette agli slider del pannello di muovere tutta la scena
    // senza ricompilare gli shader.
    const a = fakeShader(), b = fakeShader();
    ToonStyle.buildPatch(a, { saturation: 0.18, isGround: false });
    ToonStyle.buildPatch(b, { saturation: 0.18, isGround: false });
    assert.equal(a.uniforms.uOn, b.uniforms.uOn);
    assert.equal(a.uniforms.uShadowTint, b.uniforms.uShadowTint);
});

test('il flag terreno arriva nello shader', () => {
    const terra = fakeShader(), altro = fakeShader();
    ToonStyle.buildPatch(terra, { saturation: 0.1, isGround: true });
    ToonStyle.buildPatch(altro, { saturation: 0.1, isGround: false });
    assert.equal(terra.uniforms.uIsGround.value, 1);
    assert.equal(altro.uniforms.uIsGround.value, 0);
});

test('il patch tiene conto dell instancing per la posizione mondo', () => {
    // La scenografia è tutta InstancedMesh: senza instanceMatrix la posizione
    // mondo di ogni istanza sarebbe quella dell'origine del modello, e le
    // macchie del terreno risulterebbero identiche su tutte le istanze.
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    assert.ok(s.vertexShader.includes('USE_INSTANCING'), 'manca il ramo instancing');
    assert.ok(s.vertexShader.includes('instanceMatrix'), 'instanceMatrix non usata');
});

test('la fascia in ombra vira di tinta', () => {
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    assert.ok(s.fragmentShader.includes('getGradientIrradiance'),
        'il patch non ridefinisce la funzione delle fasce');
    assert.ok(s.fragmentShader.includes('uShadowTint'), 'la tinta d ombra non è usata');
});

test('il terreno dipinto usa texture, non funzioni trigonometriche', () => {
    // La prima versione calcolava il rumore in GLSL: 12 sin() per pixel su una
    // superficie che riempie mezzo schermo. Sostituito da texture
    // precalcolate (3 letture). Questo test impedisce che il rumore
    // procedurale rientri senza che nessuno se ne accorga.
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.1, isGround: true });
    assert.ok(!s.fragmentShader.includes('toonNoise'), 'il rumore procedurale è rientrato');
    assert.ok(!s.fragmentShader.includes('toonHash'), 'l hash con sin() è rientrato');
    assert.ok(s.uniforms.uNoiseTex, 'manca la texture delle chiazze');
    assert.ok(s.uniforms.uTuftTex, 'manca la texture dei ciuffi');
});

test('il rumore del terreno non viene calcolato quando i pesi sono a zero', () => {
    // Il ramo guarda i PESI e non solo "sono terreno": con chiazze e ciuffi a
    // zero il lavoro sarebbe moltiplicato per zero, ma verrebbe fatto lo
    // stesso su ogni pixel di prato.
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.1, isGround: true });
    assert.ok(s.fragmentShader.includes('uPatchAmount > 0.001'),
        'il ramo del terreno non controlla i pesi');
});

test('il patch non tocca la luce uscente', () => {
    // Una compressione delle alte luci agganciata a `outgoingLight` è stata
    // provata e RIMOSSA il 2026-08-10: ha coinciso con la comparsa di scatti
    // al playtest e non serviva, perché i chiari sfondavano per via delle
    // intensità delle luci (somma ~1.9) e non per la mancanza di un tetto.
    // Questo test impedisce che rientri per distrazione: il costo per pixel
    // del patch deve restare quello che è.
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    const dopo = s.fragmentShader.split('vec3 outgoingLight')[1] || '';
    assert.ok(!dopo.includes('uKnee') && !dopo.includes('uShoulder'),
        'la compressione delle alte luci è rientrata nello shader');
});

test('la conversione non riaccende un materiale spento', () => {
    // carLoader.js:293 nasconde la carrozzeria originale sotto il vestito
    // voxel spegnendo il MATERIALE (child.material.visible = false), non la
    // mesh — la mesh deve restare per la fisica e il raycast. Un materiale
    // nuovo che riparte da visible=true fa riemergere la carrozzeria, che ha
    // ancora la texture sorgente ROSSA, e le due superfici compenetrate si
    // contendono ogni pixel: puntini rossi che cambiano mentre l'auto si
    // muove. Bug reale osservato in localhost il 2026-08-10.
    const src = { visible: false };
    const dst = { visible: true };
    ToonStyle.copyMaterialState(src, dst);
    assert.equal(dst.visible, false);
});

test('la conversione conserva lo stato di render del materiale', () => {
    const src = {
        visible: true, side: 2, transparent: true, opacity: 0.55, alphaTest: 0.1,
        depthTest: false, depthWrite: false, colorWrite: false, blending: 5,
        premultipliedAlpha: true, dithering: true, toneMapped: false, fog: false,
        flatShading: true, wireframe: true, shadowSide: 1,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: 3,
    };
    const dst = {};
    ToonStyle.copyMaterialState(src, dst);
    for (const k of Object.keys(src)) {
        assert.equal(dst[k], src[k], `proprietà ${k} non copiata`);
    }
});

test('una proprietà assente nel sorgente non sovrascrive il default', () => {
    // Assegnare undefined al posto del default del materiale nuovo sarebbe
    // peggio che non copiare affatto.
    const dst = { visible: true, opacity: 1 };
    ToonStyle.copyMaterialState({}, dst);
    assert.equal(dst.visible, true);
    assert.equal(dst.opacity, 1);
});

test('un chunk mancante fa fallire il patch con un messaggio esplicito', () => {
    // È la rete di sicurezza principale: String.replace su una stringa
    // assente non solleva nulla e il materiale resterebbe muto, senza che
    // nessuno se ne accorga.
    const s = fakeShader();
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '');
    assert.throws(
        () => ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false }),
        /color_fragment/,
        'l errore deve nominare il chunk mancante'
    );
});
// ═══════════ L'ATLANTE DEI CARTELLONI (spec 2026-09-04) ═══════════
//
// La texture dei pannelli pubblicitari nasce da un canvas disegnato a runtime.
// Qui il canvas e' finto e REGISTRA le chiamate: cosi' si puo' chiedere cosa
// c'e' disegnato sopra — che e' l'unica domanda che conta — senza un browser.
const SponsorAtlas = require('./sponsorAtlas.js');

function finestraFinta() {
    const tratti = [];
    // Il finto tiene conto della trasformazione corrente, perche' i nomi si
    // disegnano dentro un translate + scale: senza, ogni scritta risulterebbe
    // all'origine e il test non vedrebbe dove finisce davvero.
    let stato = { dx: 0, dy: 0, sx: 1, sy: 1 };
    const pila = [];
    const ctx = {
        set fillStyle(v) { this._fill = v; },
        get fillStyle() { return this._fill; },
        set font(v) { this._font = v; },
        get font() { return this._font; },
        textAlign: '', textBaseline: '',
        save() { pila.push(Object.assign({}, stato)); },
        restore() { stato = pila.pop() || stato; },
        translate(x, y) { stato.dx += x * stato.sx; stato.dy += y * stato.sy; },
        scale(x, y) { stato.sx *= x; stato.sy *= y; },
        // Una misura plausibile: mezza altezza del font per lettera, che e'
        // circa il passo di un sans-serif grassetto.
        measureText(t) {
            const px = parseFloat((this._font || '0px').replace(/[^0-9.]/g, ' ').trim()) || 10;
            return { width: t.length * px * 0.55 };
        },
        fillRect(x, y, w, h) {
            tratti.push({ tipo: 'rect', x: stato.dx + x * stato.sx, y: stato.dy + y * stato.sy,
                          w: w * stato.sx, h: h * stato.sy, colore: this._fill });
        },
        fillText(t, x, y) {
            const px = parseFloat((this._font || '0px').replace(/[^0-9.]/g, ' ').trim()) || 10;
            tratti.push({ tipo: 'testo', testo: t, x: stato.dx + x * stato.sx, y: stato.dy + y * stato.sy,
                          largo: t.length * px * 0.55 * stato.sx, alto: px * stato.sy,
                          colore: this._fill, font: this._font });
        },
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    global.document = { createElement: () => canvas };
    global.THREE = {
        CanvasTexture: class { constructor(c) { this.image = c; } },
        RepeatWrapping: 1000, ClampToEdgeWrapping: 1001, LinearFilter: 1006,
    };
    return { tratti, canvas };
}

test('l\'atlante ha un pannello per sponsor, con fondo, banda e nome', () => {
    const { tratti, canvas } = finestraFinta();
    const tex = ToonStyle.sponsorTexture(SponsorAtlas.PANNELLI);
    const largo = canvas.width / SponsorAtlas.PANNELLI.length;
    assert.equal(canvas.width % SponsorAtlas.PANNELLI.length, 0,
        'i pannelli devono dividere esattamente la texture');

    // ⚠️ IL PANNELLO IN TEXTURE HA LE PROPORZIONI DI QUELLO IN MONDO. Il
    // nastro e' alto 1.6 e un pannello e' lungo LUNGHEZZA_PANNELLO: se il
    // riquadro disegnato avesse un altro rapporto, ogni lettera arriverebbe in
    // pista stirata di quel tanto. La prima stesura disegnava 2:1 su un
    // pannello 7.5:1, cioe' lettere larghe quattro volte la loro altezza.
    const rapportoMondo = SponsorAtlas.LUNGHEZZA_PANNELLO / 1.6;
    assert.ok(Math.abs(largo / canvas.height - rapportoMondo) / rapportoMondo < 0.02,
        `il pannello e' ${(largo / canvas.height).toFixed(2)}:1 in texture e ${rapportoMondo.toFixed(2)}:1 in mondo`);
    // E l'atlante intero sta sotto il limite di texture che ogni scheda
    // rispetta: oltre, la texture non si carica e i cartelloni spariscono.
    assert.ok(canvas.width <= 16384, `atlante largo ${canvas.width} texel`);

    const scritte = tratti.filter(t => t.tipo === 'testo');
    const nomi = SponsorAtlas.PANNELLI.map(p => p.nome);
    // Ogni nome due volte: un cartellone lungo 12 unita' con una parola sola in
    // mezzo sarebbe per due terzi colore piatto, e da dentro l'abitacolo si
    // legge quel che si ha davanti, non il centro del pannello.
    assert.equal(scritte.length, nomi.length * 2);
    nomi.forEach((n, k) => {
        assert.equal(scritte[k * 2].testo, n);
        assert.equal(scritte[k * 2 + 1].testo, n);
    });

    // ⚠️ Ogni scritta sta DENTRO il suo pannello, bordi compresi: sconfinare
    // vorrebbe dire mezza parola su un cartellone e mezza sul successivo.
    scritte.forEach((t, i) => {
        const k = Math.floor(i / 2);
        assert.ok(t.x - t.largo / 2 >= k * largo - 0.5 && t.x + t.largo / 2 <= (k + 1) * largo + 0.5,
            `${t.testo} occupa da ${(t.x - t.largo / 2).toFixed(0)} a ${(t.x + t.largo / 2).toFixed(0)}, fuori dal pannello ${k}`);
    });

    // Due rettangoli per pannello: il fondo pieno e la banda chiara in mezzo.
    const rett = tratti.filter(t => t.tipo === 'rect');
    assert.equal(rett.length, SponsorAtlas.PANNELLI.length * 2);
    const hex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');
    SponsorAtlas.PANNELLI.forEach((p, k) => {
        const fondo = rett[k * 2], banda = rett[k * 2 + 1];
        assert.equal(fondo.colore, hex(p.fondo), `pannello ${k}: fondo`);
        assert.equal(banda.colore, hex(p.banda), `pannello ${k}: banda`);
        assert.equal(fondo.h, canvas.height, 'il fondo copre tutta l\'altezza');
        assert.ok(banda.y > 0 && banda.y + banda.h < canvas.height,
            'la banda sta in mezzo, non a filo dei bordi');
        // Il nome e' scritto nel colore del FONDO, sopra la banda chiara: e'
        // il contrasto che si legge passandoci a 250 all'ora. E ci sta dentro
        // in altezza, altrimenti le lettere sborderebbero sul colore pieno.
        const testo = scritte[k * 2];
        assert.equal(testo.colore, hex(p.fondo));
        assert.ok(testo.y > banda.y && testo.y < banda.y + banda.h,
            'il nome dev\'essere dentro la banda');
        assert.ok(testo.alto < banda.h, `il nome e' alto ${testo.alto} e la banda ${banda.h}`);
    });

    // ⚠️ Niente mipmap e niente ripetizione su S: le UV del nastro non escono
    // mai da [0,1], e con Repeat il filtro all'ultimo pixel di un pannello
    // pescherebbe il primo pixel di quello all'altro capo dell'atlante.
    assert.equal(tex.generateMipmaps, false);
    assert.equal(tex.wrapS, global.THREE.ClampToEdgeWrapping);
    delete global.document; delete global.THREE;
});
