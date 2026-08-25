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
// Il valore parte quindi dal RAPPORTO, non dal numero assoluto: in un'auto
// vera l'accelerazione longitudinale di punta vale poco più di 1 g, quindi
// G_NASTRO ~ ACCEL / 1.2. Da qui la taratura (Task 7 del piano) lo sposta.
//
// ⚠️ Controllo incrociato con la fase 2: dentro un giro della morte la
// velocità minima per non fermarsi in cima vale circa sqrt(G_NASTRO * R). Con
// R = 30 unità e questo valore servono ~2.2 u/tick, poco più di un terzo della
// velocità massima: il loop diventa una cosa da prendere bene, non un muro. Se
// la taratura abbassa molto G_NASTRO, quel conto va rifatto.
const G_NASTRO = 0.155;

function isGravitaNastroActive() {
    return process.env.F1_GRAVITA_NASTRO === '1';
}

// Negativa in salita (frena), positiva in discesa (spinge). Una pendenza
// assente o malformata vale "piano": un NaN qui finirebbe in p.speed e da lì in
// posizione, tempi sul giro e classifica, senza un errore che lo dica.
function accelerazionePendenza(pendenza) {
    if (typeof pendenza !== 'number' || !Number.isFinite(pendenza)) return 0;
    const a = -G_NASTRO * Math.sin(pendenza);
    // In piano Math.sin(0) vale 0 e -G * 0 vale -0: un numero che si comporta
    // come zero dappertutto tranne nei confronti stretti (Object.is(-0, 0) è
    // false). Si normalizza qui, così un -0 non gira per la fisica a far
    // inciampare un test o un log.
    return a === 0 ? 0 : a;
}

module.exports = { G_NASTRO, isGravitaNastroActive, accelerazionePendenza };
