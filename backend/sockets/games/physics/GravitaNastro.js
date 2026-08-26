// backend/sockets/games/physics/GravitaNastro.js
//
// Gravità lungo il nastro — fase 1a (Rif.
// docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md).
// Salire costa velocità, scendere la restituisce.
//
// Responsabilità UNICA: da una pendenza in radianti all'accelerazione
// longitudinale da sommare. Non tocca `p`, non conosce la pista, non ha stato.
// Chi la applica è VehiclePhysics.updateVelocity.

// QUANTO PESA LA GRAVITÀ, E PERCHÉ NON È QUELLA VERA.
//
// La fisica di questo gioco non è in scala: ACCEL vale 0.186 u/tick^2, cioè
// diverse volte l'accelerazione longitudinale di un'auto vera. Una gravità
// fisicamente esatta (~0.03 u/tick^2 con le conversioni del gioco) su una
// salita del 10% toglierebbe circa l'1% dell'accelerazione disponibile:
// invisibile, e la fase 1a sarebbe stata implementata per niente.
//
// Il valore era partito dal RAPPORTO con un'auto vera (~1 g, cioè ACCEL / 1.2
// = 0.155). ⚠️ La misura l'ha smentito: a 0.155 l'effetto era di -2 km/h su un
// tratto in salita dove l'auto ne guadagna 120, cioè dentro il rumore. Il
// motivo è che i tratti in pendenza di `prova` coincidono con uscite di curva e
// frenate, dove comandano acceleratore e freno — non la pendenza.
//
// TARATURA DEL 2026-08-25, su `prova`, 30 giri per configurazione
// (backend/tools/f1-gravita-taratura.js). Scala provata fino a superare il
// limite, che è l'unico modo per sapere da che parte sta:
//
//   G      salita        discesa      tempo sul giro   giudizio
//   0.155  -2.0 km/h     -0.1 km/h    +0.8%            invisibile
//   0.5    -6.6 km/h     +16.1 km/h   +0.7%            si inizia a sentire
//   0.8    -12.6 km/h    +19.0 km/h   +1.2%            SCELTO
//   1.2    -37.6 km/h    +13.1 km/h   +1.2%            troppo, l'auto arranca
//
// (variazione di velocità DENTRO il tratto, ingresso -> uscita: la media
// semplice in salita mescola l'effetto locale con la storia accumulata prima e
// non serve a tarare.)
//
// A 0.8, sui 30 giri: velocità media in salita -10.3%, in discesa +2.1%, in
// piano -0.1% (invariata, come dev'essere), 30/30 giri completati.
//
// ⚠️ I BOT NON ARRIVANO LUNGHI, verificato a questo valore: le curve più lente
// restano le stesse e le loro velocità minime SCENDONO (97.4 -> 90.2 km/h al
// 76.5% del giro), perché la salita rallenta anche loro. Il rischio dichiarato
// nella spec — `cornerTargetSpeed` non conosce la pendenza, quindi in fondo a
// una discesa il bot frenerebbe tardi — non si manifesta su `prova`. Chi
// alzasse G_NASTRO deve rifare questo controllo.
//
// ⚠️ Controllo incrociato con la fase 2: dentro un giro della morte la velocità
// minima per non fermarsi in cima vale circa sqrt(G_NASTRO * R). A 0.8 servono
// 4.9 u/tick per un loop di raggio 30, cioè il 79% della velocità massima:
// tanto. I loop andranno tenuti stretti (raggio 15-25) o quel numero diventa un
// muro. Con G più basso il conto si allenta.
const G_NASTRO = 0.8;

// ACCESA DI DEFAULT dal playtest del 2026-08-25, approvato dall'utente. Al
// contrario degli altri modelli dietro flag (F1_TYRE_SLIP_MODEL e compagnia,
// che restano percorsi di confronto spenti), questa è ormai la fisica normale
// del gioco: si spegne solo esplicitamente, con F1_GRAVITA_NASTRO=0, per
// confrontare o per isolare un problema.
function isGravitaNastroActive() {
    return process.env.F1_GRAVITA_NASTRO !== '0';
}

// Negativa in salita (frena), positiva in discesa (spinge). Una pendenza
// assente o malformata vale "piano": un NaN qui finirebbe in p.speed e da lì in
// posizione, tempi sul giro e classifica, senza un errore che lo dica.
// DENTRO IL GIRO DELLA MORTE LA GRAVITA' PESA UN QUARTO.
//
// Non e' uno sconto estetico, e' il vincolo di energia: salire di due raggi
// costa v² = 4·G·R. Con G a 0.8 il raggio massimo percorribile sarebbe 12 — un
// loop alto quanto la pista e' larga, e per giunta da imboccare a 341 km/h
// esatti per fermarsi giusto in cima, cioe' mai. Con G a 0.2 il tetto sale a
// ~45 e un loop di raggio 25 (alto 50, il doppio della larghezza pista) si
// prende a 246 km/h, il 72% del massimo.
//
// Scelta dell'utente il 2026-08-26: «io voglio dei loop che idealmente possano
// essere anche grandi, quindi accetto la tua proposta di rendere la gravita' un
// quarto rispetto al resto dentro il loop». Dentro il tubo la fisica e'
// comunque un regime dichiarato — l'auto e' incollata al nastro e il fuoripista
// non esiste — quindi non e' una fisica che cambia di nascosto.
//
// ⚠️ Un test lega questo numero al raggio massimo del modello dei tratti: se
// qualcuno alza RAGGIO_ACROBATICO_MAX senza abbassare questo, il default
// dell'editor diventa un loop che nessuno completa, e il test lo dice.
const G_ACROBATICO = G_NASTRO / 4;

// Negativa in salita (frena), positiva in discesa (spinge). Una pendenza
// assente o malformata vale "piano": un NaN qui finirebbe in p.speed e da lì in
// posizione, tempi sul giro e classifica, senza un errore che lo dica.
//
// `g` serve al giro della morte, dove la gravita' pesa un quarto: senza
// argomento vale quella normale, quindi per tutto il resto della pista non
// cambia niente.
function accelerazionePendenza(pendenza, g) {
    if (typeof pendenza !== 'number' || !Number.isFinite(pendenza)) return 0;
    const peso = (typeof g === 'number' && Number.isFinite(g)) ? g : G_NASTRO;
    const a = -peso * Math.sin(pendenza);
    // In piano Math.sin(0) vale 0 e -G * 0 vale -0: un numero che si comporta
    // come zero dappertutto tranne nei confronti stretti (Object.is(-0, 0) è
    // false). Si normalizza qui, così un -0 non gira per la fisica a far
    // inciampare un test o un log.
    return a === 0 ? 0 : a;
}

// Oltre questa pendenza (radianti) l'auto non sale più: la gravità lungo il
// nastro supera tutta l'accelerazione che il motore può dare, quindi la
// macchina rallenta fino a fermarsi e poi riscende all'indietro.
//
// Non è una regola a parte: è una conseguenza diretta di G_NASTRO, e per questo
// vive qui e non in una costante scritta a mano da qualche altra parte. Col
// valore attuale e l'ACCEL nominale il limite sta attorno al 24% di pendenza —
// mentre il validatore segnala già tutto ciò che supera il 15%, quindi una
// pista valida resta percorribile con margine.
//
// `accelDisponibile` è l'accelerazione del motore in u/tick^2: ACCEL nominale,
// o quella effettiva se si vuole tenere conto di usura e danni.
function pendenzaMassimaInSalita(accelDisponibile) {
    const rapporto = accelDisponibile / G_NASTRO;
    if (!(rapporto > 0)) return 0;
    if (rapporto >= 1) return Math.PI / 2;   // gravità irrilevante: si sale tutto
    return Math.asin(rapporto);
}

// Accelerazione nominale del motore (PowertrainModel.ACCEL), ricopiata qui per
// non creare una dipendenza circolare fra i due moduli. Serve solo come valore
// di riferimento per la domanda «questa pista si può percorrere?».
const ACCEL_NOMINALE = 0.186;

// Se una pista ha una salita che nessuna auto sale, non è percorribile: sopra
// `pendenzaMassimaInSalita` la macchina rallenta fino a fermarsi e riscende.
//
// Serve ai test che pretendono un giro completo: pretenderlo da una parete è
// pretendere l'impossibile. Il criterio sta QUI e non in un elenco di piste da
// saltare, perché un elenco divergerebbe al primo tracciato nuovo e non si
// aggiornerebbe da solo se G_NASTRO cambiasse.
function pistaPercorribile(points, accelDisponibile) {
    if (!isGravitaNastroActive()) return true;
    const limite = pendenzaMassimaInSalita(
        typeof accelDisponibile === 'number' ? accelDisponibile : ACCEL_NOMINALE);
    for (const p of points) {
        // ⚠️ Dentro un giro della morte la pendenza arriva a 90 gradi e oltre,
        // ed e' normale: li' la gravita' pesa un quarto e la posizione la
        // comanda il nastro, quindi il conto di questa funzione — «con questa
        // accelerazione, questa salita si sale?» — non descrive niente. Il tubo
        // ha il suo criterio, TrackAcrobatico.velocitaMinima.
        if (p.acrobatico) continue;
        if ((p.pendenza || 0) > limite) return false;
    }
    return true;
}

module.exports = {
    G_NASTRO, G_ACROBATICO, ACCEL_NOMINALE, isGravitaNastroActive, accelerazionePendenza,
    pendenzaMassimaInSalita, pistaPercorribile
};
