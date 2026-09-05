# I livelli di difficoltà dei bot — design

**2026-09-05.** Blocco H della carrellata del 23-08, seconda voce (H2). Nasce
dalla richiesta dell'utente: «difficoltà multiple, attacco e difesa».

## 1. Il problema, misurato

La difficoltà oggi **esiste già, ma gira a caso.** Alla creazione della griglia
ogni bot pesca due numeri (`f1Bot.js`, `createBots`):

- `botSpeedFactor` fra **0.93 e 1.00** — il ritmo, fisso per tutta la gara;
- `botPrecisionNoise` fra **0 e 0.25** — il rumore che si aggiunge allo sterzo.

Misurato su `prova` col banco prova (`f1LapSimulator`, tre giri per casella,
giro umano di riferimento **47.30 s**):

| | ritmo 1.00 | 0.97 | 0.94 | 0.90 |
|---|---|---|---|---|
| **rumore 0** | +1.85 s | +3.45 | +4.10 | +5.55 |
| **rumore 0.08** | +2.13 | +3.67 | +4.40 | +5.72 |
| **rumore 0.16** | +2.47 | +3.87 | +4.70 | +5.80 |
| **rumore 0.25** | +3.23 | +4.28 | +5.30 | +6.27 |

Cioè: **il giocatore incontra oggi avversari che vanno da +1.9 a +5.6 secondi
al giro, e nessuno lo decide.** Due gare di fila sulla stessa pista possono
essere una passeggiata o un muro.

Il ritmo vale 3.7 secondi di escursione, il rumore 1.4. Sono le due leve, ed
esistono entrambe: non c'è niente da inventare, c'è da smettere di tirarle a
caso.

⚠️ **Il tetto.** Anche a ritmo pieno e rumore zero il bot resta a **1850 ms**
dal passo dell'utente. «Difficile» sarà tosto, non alla pari. Portarlo alla
pari è un altro progetto — ottimizzatore con la fitness col rumore più lo
sterzo feedforward (spec 2026-08-08) — e ha senso solo se «difficile» così non
basta. Rif. [H1] in `project_f1_bot_competitivi`.

## 2. Le decisioni dell'utente

1. **Un livello scelto in lobby**, uguale per tutti i bot della gara — non bot
   di livelli diversi nella stessa griglia.
2. Fra un livello e l'altro cambiano **ritmo e aggressività**. Niente errori
   deliberati (bloccare le ruote, allargare) ai livelli bassi.
3. **Tre livelli: Facile, Medio, Difficile.** Default: Medio.
4. La difesa cresce col livello ma senza contatto volontario — è H3, e questo
   design deve lasciarle l'aggancio.

## 3. Cos'è un livello

Un livello è **una coppia di intervalli**, non due numeri fissi:

| livello | ritmo | rumore | dove cade su `prova` (misurato) |
|---|---|---|---|
| Facile | 0.905 – 0.925 | 0.16 – 0.22 | da +5.02 a +5.80 s |
| Medio | 0.945 – 0.965 | 0.08 – 0.14 | da +3.67 a +4.38 s |
| Difficile | 0.985 – 1.000 | 0.00 – 0.06 | da +1.85 a +3.23 s |

⚠️ **Gli intervalli sono STRETTI, e devono restarlo.** La prima taratura di
questa spec li faceva larghi (0.90-0.94, 0.95-0.98, 0.98-1.00) e i tre livelli
si SOVRAPPONEVANO: misurato, il bot piu' lento di Difficile faceva +3.50 s e il
piu' veloce di Medio +3.17, cioe' il livello alto era piu' lento di quello
medio. L'escursione dentro un livello non puo' superare la distanza fra un
livello e l'altro. Con questi numeri restano 0.44 s di stacco fra Difficile e
Medio e 0.64 fra Medio e Facile.

⚠️ **Intervalli e non valori fissi**, perché la varianza fra i bot è ciò che
rompe l'ordine statico della griglia: senza, chi parte davanti resta davanti e
non si vede un sorpasso per tutta la gara. È una richiesta esplicita
dell'utente già scritta nei commenti di `f1Bot.js`, e va conservata.

I due intervalli si muovono **insieme e nello stesso verso**: al livello alto
bot più veloci *e* più precisi. Non è un caso — un bot veloce e impreciso esce
di pista (misurato: ritmo 1.00 con rumore 0.25 fa 13 tick fuori dal cordolo,
mentre lo stesso rumore a ritmo 0.97 ne fa 3).

## 4. Dove vive il livello

`lobby.js` (`gameSettings.f1`, accanto a `botsEnabled` e `gridSize`)
→ `game.settings.botDifficolta` → `createBots`, che è l'unico punto dove oggi
si pescano quei due numeri.

Il valore è una stringa fra `facile` / `medio` / `difficile`. Un valore
assente o sconosciuto vale `medio`: le lobby già aperte e i client vecchi non
devono rompersi, e un livello sconosciuto non deve produrre bot senza ritmo.

## 5. L'aggressività

Lo stesso livello scala **due soglie che esistono già** in `f1Bot.js`:

- `BOT_OVERTAKE_PACE_MARGIN` (oggi 1.01) — quanto margine di velocità serve a
  un bot per tentare il sorpasso. Al livello alto scende: attacca con meno.
- `BOT_FOLLOW_MIN_FRACTION` (oggi 0.85) — quanto si accoda a chi precede. Al
  livello alto sale: sta più attaccato, cerca l'occasione.

⚠️ Nessuna soglia nuova, nessun comportamento nuovo: solo i numeri che già
governano l'aggressività, presi dal livello invece che da una costante. È
l'aggancio che H3 userà per la difesa, e va disegnato ora così com'è per non
rifarlo dopo.

## 6. Le stagioni

In campionato i bot sono **fissati alla creazione della stagione** (colore e
nome uguali per tutte le gare, `f1Bot.js` lo dice esplicitamente). Il livello
è parte di quella scelta: va **salvato con la stagione** e riletto ad ogni
gara. Senza, la seconda gara avrebbe avversari di un altro livello e la
classifica sommerebbe punti presi contro avversari diversi.

## 7. Cosa NON cambia

- Il modello di guida: `cornerTargetSpeed`, il pure-pursuit, le traiettorie.
- Il rumore ai box: `BOT_PIT_APPROACH_NOISE_SCALE` continua a ridurre il
  rumore nell'avvicinamento, che è una correzione di manovra, non di
  difficoltà.
- La varianza giro-per-giro (`BOT_LAP_PACE_VARIANCE`, ±4%): è il «giorno buono
  / giorno storto», vale per tutti i livelli.

## 8. Le invarianti da provare

Su ogni livello e su più piste:

1. **I tre livelli non si sovrappongono**: il bot piu' lento di un livello resta
   piu' veloce del piu' rapido del livello sotto. Misurato su `prova`: 0.44 s di
   stacco fra Difficile e Medio, 0.64 fra Medio e Facile. E' l'invariante che la
   prima taratura violava.
2. **Dentro un livello i bot restano diversi**: fra il più veloce e il più
   lento della griglia c'è uno scarto di ritmo misurabile, o la gara è una
   fila indiana.
3. **Nessun livello fa uscire di pista più di oggi**: i tick oltre il cordolo
   di un bot a Difficile non superano quelli di un bot medio di oggi.
4. **Un livello assente o sconosciuto vale Medio**, e non produce mai un bot
   senza ritmo (`botSpeedFactor` sempre > 0).
5. **In campionato il livello non cambia fra una gara e l'altra** della stessa
   stagione.

## 9. Il playtest

Una gara per livello su `prova`, guardando due cose che i numeri non dicono:
se a Facile i bot sono *divertenti* e non solo lenti, e se a Difficile
attaccano in modo credibile o solo fastidioso.
