// frontend/shared/impostazioniLobby.test.js
//
// LE IMPOSTAZIONI DELLA LOBBY ARRIVANO AL SERVER DA SOLE, ma solo se il
// controllo rispetta due regole.
//
// `saveGameSettings` (lobby.js) non conosce i singoli campi: scorre TUTTI i
// `<select>` dentro la sezione del gioco e ne fa `settings[id senza prefisso]
// = value`. E' un meccanismo comodo — si aggiunge un'impostazione scrivendo
// solo l'HTML — ma silenzioso: un id che non segue lo schema, o un controllo
// messo fuori dalla sua sezione, non arriva al server e non lo dice nessuno.
// La partita parte con quell'impostazione al valore di ripiego, e il difetto
// si vede solo giocando.
//
// ⚠️ Nato mentre si aggiungeva il livello di difficolta' dei bot
// (2026-09-05): non c'era modo di accorgersi di uno di questi due errori
// senza aprire il browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(FRONTEND, 'lobby.html'), 'utf8');
const js = fs.readFileSync(path.join(FRONTEND, 'lobby.js'), 'utf8');

// Il pezzo di HTML di una sezione `<div class="settings-section" id="<gioco>-settings">`.
function sezioneDi(gioco) {
    const apre = html.indexOf(`id="${gioco}-settings"`);
    if (apre < 0) return '';
    // Fino all'inizio della sezione successiva, o alla fine del contenitore.
    const dopo = html.indexOf('settings-section', apre + 10);
    return html.slice(apre, dopo < 0 ? apre + 4000 : dopo);
}

// I valori di partenza dichiarati in lobby.js, per gioco.
function chiaviDichiarate(gioco) {
    const m = js.match(new RegExp(gioco + ':\\s*\\{([^}]*)\\}'));
    if (!m) return [];
    return (m[1].match(/(\w+)\s*:/g) || []).map(s => s.replace(':', '').trim());
}

test('ogni impostazione F1 dichiarata ha il suo controllo nella sezione F1', () => {
    const sezione = sezioneDi('f1');
    assert.ok(sezione.length > 0, 'sezione f1-settings non trovata in lobby.html');
    for (const chiave of chiaviDichiarate('f1')) {
        assert.ok(sezione.includes(`id="f1-${chiave}"`),
            `l'impostazione "${chiave}" e' dichiarata in lobby.js ma non ha un controllo ` +
            `con id="f1-${chiave}" dentro #f1-settings: al server arrivera' sempre il ripiego`);
    }
});

test('ogni controllo della sezione F1 e\' dichiarato in lobby.js', () => {
    // Il verso opposto: un controllo che nessuno dichiara arriva comunque al
    // server (saveGameSettings li legge tutti), ma parte senza valore di
    // partenza — e chi apre la lobby vede la prima opzione della lista invece
    // di quella scelta come predefinita.
    const sezione = sezioneDi('f1');
    const dichiarate = chiaviDichiarate('f1');
    for (const m of sezione.matchAll(/<select id="f1-(\w+)"/g)) {
        assert.ok(dichiarate.includes(m[1]),
            `il controllo "f1-${m[1]}" non ha un valore di partenza in lobby.js`);
    }
});

test('il livello di difficolta\' offre esattamente i tre livelli veri', () => {
    // ⚠️ I valori dell'HTML devono essere quelli che il codice di gioco
    // riconosce: uno storto verrebbe normalizzato a `medio` in silenzio, e il
    // giocatore sceglierebbe «Hard» ottenendo una gara media.
    const F1Difficolta = require('./f1Difficolta.js');
    const sezione = sezioneDi('f1');
    const select = sezione.slice(sezione.indexOf('id="f1-botDifficolta"'));
    const valori = [...select.slice(0, select.indexOf('</select>')).matchAll(/value="(\w+)"/g)]
        .map(m => m[1]);
    assert.deepEqual(valori.sort(), [...F1Difficolta.LIVELLI].sort());
    for (const v of valori) {
        assert.equal(F1Difficolta.normalizza(v), v, `il valore "${v}" non e' un livello vero`);
    }
});
