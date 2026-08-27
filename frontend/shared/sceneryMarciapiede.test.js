// frontend/shared/sceneryMarciapiede.test.js
//
// L'ARREDO URBANO E LE SUE TRE TABELLE.
//
// Un arredo del marciapiede vive in quattro posti diversi: il builder in
// `backend/tools/circuitAssets/cittaStrada.py`, il percorso in
// `sceneryAssetPaths.js`, l'ingombro in `sceneryAssetSizes.js` e il passo in
// `sceneryMarciapiede.js`. Nessuno dei quattro sa degli altri.
//
// ⚠️ E IL DISALLINEAMENTO E' SILENZIOSO. Un asset senza ingombro non solleva:
// `sizeOf` restituisce il ripiego di 6x6x6, e da lì in poi la porta della
// scenografia giudica un lampione come se fosse un cubo di sei unità — scarta
// cose che ci starebbero e ne accetta altre che si compenetrano, con tutti i
// test verdi. E' successo davvero, con tredici asset: vedi la nota in
// sceneryAssetSizes.js.
//
// ⚠️ Gira con `node --test frontend/shared/`, non con `node --test backend/`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const Marciapiede = require('./sceneryMarciapiede.js');
const Paths = require('./sceneryAssetPaths.js');
const Sizes = require('./sceneryAssetSizes.js');
const { inspectGlb } = require('../../backend/tools/glbInspect.js');

const ROOT = path.join(__dirname, '..', '..');
const GLB = path.join(ROOT, 'frontend', 'assets', 'custom', 'circuit');

// Le auto in linea non stanno in PASSI (hanno un passo loro, a gruppi), ma
// sono arredo del marciapiede come gli altri e vanno controllate uguale.
const AUTO = ['parkedCarRed', 'parkedCarBlue', 'parkedCarWhite'];
const TUTTI = [...Object.keys(Marciapiede.PASSI), ...AUTO];

test('ogni arredo del marciapiede ha un percorso e un modello sul disco', () => {
    for (const asset of TUTTI) {
        const url = Paths.PERCORSI[asset];
        assert.ok(url, `${asset}: nessun percorso in sceneryAssetPaths`);
        const file = path.join(GLB, path.basename(url));
        assert.ok(fs.existsSync(file), `${asset}: manca ${path.basename(url)}`);
    }
});

test('ogni arredo ha un ingombro VERO, e coincide col .glb', () => {
    // Il ripiego: se un asset lo prende, il confronto sotto lo prende in
    // pieno, ma il messaggio dice l'altra cosa — che l'ingombro non c'e'.
    const RIPIEGO = Sizes.sizeOf('__questo-asset-non-esiste__');
    for (const asset of TUTTI) {
        const s = Sizes.sizeOf(asset);
        assert.notDeepEqual(s, RIPIEGO,
            `${asset}: nessun ingombro in sceneryAssetSizes, sta usando il ripiego ${JSON.stringify(RIPIEGO)}`);
        const misurato = inspectGlb(path.join(GLB, path.basename(Paths.PERCORSI[asset]))).size;
        // La tabella e' scritta a un decimale: la tolleranza e' mezza cifra.
        for (const [k, i] of [['w', 0], ['h', 1], ['d', 2]]) {
            assert.ok(Math.abs(s[k] - misurato[i]) <= 0.06,
                `${asset}.${k}: la tabella dice ${s[k]}, il modello ${misurato[i].toFixed(2)}`);
        }
    }
});

test('le corsie nominano solo arredi che esistono, e non si sovrappongono', () => {
    const noti = new Set(TUTTI);
    for (const [nome, insieme] of [['AL_PALAZZO', Marciapiede.AL_PALAZZO],
                                   ['AL_CORDOLO', Marciapiede.AL_CORDOLO],
                                   ['ENTRAMBI_I_LATI', Marciapiede.ENTRAMBI_I_LATI]]) {
        for (const asset of insieme) {
            assert.ok(noti.has(asset), `${nome} nomina ${asset}, che non e' un arredo del marciapiede`);
        }
    }
    // Un arredo non puo' stare contro la facciata E sul filo del cordolo: sono
    // le due sponde opposte della stessa strada, e la prima vincerebbe in
    // silenzio (l'ordine dei rami in `posa`).
    for (const asset of Marciapiede.AL_CORDOLO) {
        assert.ok(!Marciapiede.AL_PALAZZO.has(asset),
            `${asset} sta in tutte e due le corsie estreme`);
    }
});

test('sul filo del cordolo ci sta solo roba poco profonda', () => {
    // La corsia del cordolo sta a 2.2 dal muro: un oggetto profondo piu' di
    // 4.4 lo sfonderebbe gia' in rettilineo, e la porta lo scarterebbe sempre.
    // Il margine vero e' piu' stretto — in curva gli angoli di un pezzo largo
    // si scostano — ma questo e' il limite oltre il quale non c'e' speranza.
    for (const asset of Marciapiede.AL_CORDOLO) {
        const d = Sizes.sizeOf(asset).d;
        assert.ok(d / 2 < Marciapiede.DAL_MURO_FILO,
            `${asset} e' profondo ${d}: sul filo del cordolo finisce oltre il muro`);
    }
});

test('nessun arredo ha lo stesso passo di un altro', () => {
    // Due passi uguali fanno cadere due arredi sullo stesso campione ogni volta
    // che le loro sfasature coincidono, e li' la porta ne scarta uno per
    // sempre: l'asset esiste, e' generato, e non si vede mai.
    const passi = Object.values(Marciapiede.PASSI);
    assert.equal(new Set(passi).size, passi.length,
        `passi duplicati: ${passi.filter((p, i) => passi.indexOf(p) !== i)}`);
});
