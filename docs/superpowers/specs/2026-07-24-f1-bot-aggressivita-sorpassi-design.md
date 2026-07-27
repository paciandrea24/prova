# F1 — bot più aggressivi: pressione e sorpassi (sotto-progetto C)

## Contesto

Ultimo dei 4 problemi segnalati dall'utente in questa sessione su [[project_f1_bot_ai]]
(bug ultimo giro e pit stop mancati già risolti e confermati). L'utente osserva
che i bot restano quasi sempre in fila indiana per tutta la gara, raramente si
sorpassano tra loro anche quando uno è palesemente più lento. Vuole racing
"realistico": ordine perlopiù stabile (chi è oggettivamente più forte resta
avanti più spesso), ma con vere battaglie visibili — un bot più lento che tenta
di resistere, sorpassi che si vedono costruirsi e succedere in pista, non un
salto di posizione istantaneo. Effetto visivo della scia (lineette) resta SOLO
sulla propria auto (deciso esplicitamente, nessuna modifica frontend).

Meccaniche già esistenti e NON toccate da questo lavoro:
- Scia (`SLIPSTREAM_RANGE_M=25`, `SLIPSTREAM_MAX_BOOST=0.08` in `f1GameSocket.js`,
  righe 39-40): già condivisa umani+bot, applica un boost di velocità massima
  fino a +8% entro 25m da chi precede. Funziona già, non è il problema.
- `botSpeedFactor` (0.93-1.0, fisso per bot per tutta la gara): la gerarchia di
  fondo voluta esplicitamente in una sessione precedente ("griglia già ordinata
  per ritmo, quasi nessun sorpasso tra bot" era il comportamento base voluto
  allora). Non si tocca il range.
- `botLapPaceMult` (±4%, ri-estratto ad ogni giro): il meccanismo che rompe
  l'ordine statico giorno-buono/giorno-storto. Non si tocca.

## Causa isolata

In `backend/sockets/games/f1Bot.js` (righe ~680-702 ramo racing-line, ~767-788
ramo geometrico, stessa logica duplicata nei due rami), quando un bot è entro
`BOT_FOLLOW_GAP_M` (15m) dall'auto che precede:

- Se ha un margine di velocità vero ≥`BOT_OVERTAKE_PACE_MARGIN` (5%) E la curva
  è dolce (`severity < BOT_OVERTAKE_MAX_CORNER_SEVERITY`, 0.4): tenta il
  sorpasso.
- **Altrimenti**: `targetSpeed *= 1 - closeness*(1-BOT_FOLLOW_MIN_FRACTION)` —
  più è vicino, più rallenta, fino al 55% della velocità normale quasi a
  contatto.

Il problema è il ramo "altrimenti": un bot che si avvicina ma non ha ancora un
margine del 5% (soglia alta rispetto alla variabilità di ritmo di ±4%/giro, che
raramente produce un differenziale istantaneo così ampio) **rallenta bruscamente
invece di restare a ridosso**. Perde lo slancio/la scia appena costruita e si
stacca, invece di tallonare aspettando l'occasione — da qui la fila indiana:
anche un bot leggermente più veloce raramente arriva ad avere il margine
richiesto PRIMA di essersi già staccato.

## Modifiche proposte (solo tuning di costanti esistenti + una formula)

Tutte in `backend/sockets/games/f1Bot.js`, stessi punti in entrambi i rami
(racing-line e geometrico) per restare coerenti:

1. **`BOT_FOLLOW_MIN_FRACTION`: 0.55 → 0.85.** Quando non sta sorpassando, il
   bot tallona (85% di velocità minima) invece di staccarsi (55%) — resta
   vicino abbastanza a lungo da sfruttare la scia e trovare un'occasione reale,
   invece di perdere subito la posizione di attacco.
2. **`BOT_OVERTAKE_PACE_MARGIN`: 1.05 → 1.02** (5% → 2% di margine richiesto).
   Coerente con la variabilità di ritmo già esistente (±4%/giro): un margine
   più vicino a quella scala rende i tentativi frequenti quando c'è davvero un
   divario, senza eliminarlo quando non c'è (un bot oggettivamente più lento
   di base, `botSpeedFactor` più basso, continuerà a non avere margine quasi
   mai).
3. **`BOT_FOLLOW_GAP_M`: 15 → 22** (metri). Zona di "battaglia" (scia +
   pressione + tentativo di sorpasso) più ampia, più spazio/tempo per costruire
   e completare un sorpasso prima che finisca il rettilineo o la curva dolce.

`BOT_OVERTAKE_MAX_CORNER_SEVERITY` (0.4) e `BOT_OVERTAKE_FRACTION` (0.55, quanto
ci si sposta lateralmente) restano invariati — non è stato osservato un problema
lì, e i sorpassi reali avvengono già prevalentemente su rettilinei/curve dolci
in F1 vera.

## Rischio principale e mitigazione

Alzare `BOT_FOLLOW_MIN_FRACTION` a 0.85 avvicina molto i bot tra loro: rischio
di collisioni/testacoda più frequenti tra bot ravvicinati, specialmente in
frenata prima di una curva stretta (dove il sorpasso non è permesso ma la
velocità target del bot dietro può comunque restare alta). Le collisioni
auto-auto esistenti (`resolveCollisions`) restano invariate e già gestiscono
il contatto fisico — non è una modifica a quella logica, solo al bersaglio di
velocità. Verifica: playtest in localhost con più bot ravvicinati, in
particolare in frenata prima delle curve strette di Monza (dove la fila indiana
attuale è più visibile).

## Testing

Nessun test automatico nuovo previsto: sono tre costanti + verifica
comportamentale (quanti sorpassi/quanto restano vicini i bot), non testabile
in modo significativo con test geometrici diretti come `apexOffset`/
`overtakeOffset` (quelli verificano un segno/verso, qui il criterio è "si vede
in gara"). Verifica in localhost, come da convenzione di progetto — se emergono
collisioni eccessive tra bot ravvicinati, si può smorzare `BOT_FOLLOW_MIN_FRACTION`
verso un valore intermedio (es. 0.75) prima di procedere oltre.
