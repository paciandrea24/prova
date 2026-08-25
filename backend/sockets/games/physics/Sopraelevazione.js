// backend/sockets/games/physics/Sopraelevazione.js
//
// Quanto aiuta una curva sopraelevata — fase 1b (Rif.
// docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md).
//
// Responsabilità UNICA: da un rollio in radianti al fattore di cui migliora la
// tenuta in curva. Non tocca `p`, non conosce la pista, non ha stato.
//
// ⚠️ DUE CONSUMATORI INDIPENDENTI, e devono leggere lo STESSO numero:
//   - SteeringModel.applySteering, dove la sterzata si ESEGUE (l'auto gira più
//     stretto a parità di velocità);
//   - CorneringGripModel.corneringCapacity, dove il bot DECIDE quanto frenare
//     per la curva che sta arrivando.
// È la stessa separazione già documentata per il peso del carburante e per il
// downforce. Se i due divergessero, il bot entrerebbe in curva credendo di
// avere un'aderenza che la fisica non gli dà: va lungo, esce, e il banking
// RALLENTA invece di aiutare. È successo davvero — misurato un giro più lento
// del 12% quando il fattore stava solo dalla parte del bot.
const ROLLIO_MAX = 45 * Math.PI / 180;

// Quanto in più tiene l'auto sulla sopraelevazione più ripida ammessa (45°).
// Tarato in pista: vedi il piano della fase 1b-1.
const BANKING_GUADAGNO_MAX = 0.35;

// Un rollio assente o malformato vale piano, mai NaN: un NaN qui si
// propagherebbe alla traiettoria senza un errore che lo dica.
//
// Il guadagno cresce col seno del rollio — è la componente di peso che si
// riversa sulla curva — normalizzato sul rollio massimo, così vale esattamente
// BANKING_GUADAGNO_MAX sulla parabolica più ripida e non oltre: una curva non
// deve mai diventare gratis.
function fattoreBanking(rollio) {
    if (typeof rollio !== 'number' || !Number.isFinite(rollio) || rollio <= 0) return 1;
    const quota = Math.min(1, Math.sin(rollio) / Math.sin(ROLLIO_MAX));
    return 1 + BANKING_GUADAGNO_MAX * quota;
}

module.exports = { fattoreBanking, BANKING_GUADAGNO_MAX, ROLLIO_MAX };
