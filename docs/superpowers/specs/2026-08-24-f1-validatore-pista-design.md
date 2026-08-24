# F1 — «Controlla la pista» (blocco D5)

Ultimo progetto del blocco D, aperto il 2026-08-24 dopo l'editor a segmenti
([[project_f1_editor_segmenti]]) e l'anteprima ([[project_f1_anteprima_esplorabile]]).

## Il problema

Una pista disegnata può avere difetti che si scoprono **in gara**: dopo aver
finito il disegno, aperto una lobby e corso fino al punto giusto.

Non è teoria. `nuova-pista`, disegnata dall'utente in dieci minuti col nuovo
editor, ha tre difetti che nessuno gli ha detto:

1. i bot **non completano il giro** entro il tetto di sicurezza;
2. i bot **non entrano ai box** — la corsia non li accetta;
3. il traguardo cade **dentro una curva** di raggio 39, e la tribuna
   principale non ci sta: zero moduli su una fila che dovrebbe averne dodici.

Il terzo l'ha trovato un test di scenografia, gli altri due un test dei bot.
L'autore, mentre disegnava, non aveva modo di saperlo.

## Cosa deve fare

Un pulsante **«Controlla la pista»** nell'editor che elenca i problemi, con
tre livelli:

- **impedisce di salvare** — la pista non è caricabile o non è correbile;
- **da guardare** — si corre, ma qualcosa non funzionerà come previsto;
- **da sapere** — scelte lecite ma insolite, che è meglio siano volute.

Ogni voce dice **dove**, e cliccandola la vista dell'editor ci va sopra: un
elenco di difetti senza coordinate costringe a cercarli, ed è la ragione per
cui gli avvisi non si leggono.

## Il vincolo che decide tutto

**Un difetto è definito una volta sola.** Oggi le stesse misure vivono in due
posti: le invarianti di scenografia stanno dentro
`frontend/shared/scenografiaInvarianti.test.js`, cioè in un file di test, e il
validatore avrebbe bisogno delle stesse. Copiarle vorrebbe dire che un giorno
il test dirà una cosa e il pulsante un'altra.

Quindi: le misure escono dal test e diventano **`frontend/shared/trackValidatore.js`**,
che il test usa al posto delle proprie. Il file di test resta — con dentro le
piste da controllare e le soglie — ma la definizione di "difetto" è una.

## I controlli

**Geometria** (istantanei, il modulo è puro):

| Controllo | Livello | Perché |
|---|---|---|
| meno di 3 nodi / punti | impedisce | il gioco non carica la pista |
| corsia box con meno di 3 punti | impedisce | `trackLoader` la rifiuta |
| `boxIndex` fuori dalla corsia | impedisce | il box del pilota non esiste |
| riquadro d'ingresso che non tocca la corsia | impedisce | `saveTrack` lo rifiuta già |
| riquadro d'ingresso che sborda sull'asfalto | da guardare | manda ai box chi passa dritto |
| raggio minimo sotto 1.5 mezze carreggiate | da guardare | curva quasi impercorribile |
| pendenza oltre il 15% | da guardare | difficile da guidare |
| traguardo in una curva sotto raggio 60 | da guardare | la tribuna principale non ci sta |
| verso del traguardo oltre 90° dal verso reale | impedisce | i bot partono contromano |
| giro sotto 800 unità | da sapere | pista molto corta |

**Scenografia** (richiede di generare il layout, ~1 secondo):

| Controllo | Livello |
|---|---|
| oggetti dentro la carreggiata | impedisce |
| oggetti dentro la via di fuga (esclusa la `safety`) | da guardare |
| oggetti dentro la corsia box | da guardare |
| spettatori senza la loro tribuna | da guardare |
| tribuna principale con zero moduli | da guardare |

⚠️ **Nessun controllo che richieda di simulare un giro.** Sapere se i bot
completano il giro vorrebbe dire far girare `f1LapSimulator`, che è lento e
rumoroso (N=30 per avere un numero stabile). Resta fuori: il validatore dice
quello che può dire in un secondo, e lo dice mentre disegni.

## Le soglie, e da dove vengono

Misurate sulle piste esistenti il 2026-08-24, non scelte a naso:

- **raggio minimo**: melbourne 19.5, suzuka 22.2, prova 31.5, monte-rosso 48.8.
  Sotto 1.5 mezze carreggiate (16.5 su una pista da 22) nessuna pista
  esistente scende: è la soglia oltre la quale si sta facendo qualcosa di
  nuovo, e va saputo. ⚠️ Il raggio **da solo non predice** se i bot
  completeranno il giro — melbourne è la più stretta e li completa: per questo
  è «da guardare» e non «impedisce».
- **traguardo in curva**: monte-rosso ha raggio 305 al traguardo e dodici
  moduli di tribuna; `nuova-pista` ha 39 e zero. La soglia sta in mezzo, a 60.
- **pendenza 15%**: oltre, in gara la macchina non tiene la traiettoria.

## Come si verifica

Il modulo è puro, quindi si prova senza browser. Il test che conta:
**ogni pista esistente passa i controlli che oggi passa**, e `nuova-pista`
— l'unica con difetti veri — li segnala. Poi il file delle invarianti usa il
validatore, quindi se le due definizioni divergessero il test si accorgerebbe
subito.

## Cosa resta fuori

- Simulare il giro (vedi sopra).
- **Correggere** i difetti: il validatore dice, non aggiusta. Un editor che
  sposta le cose da solo mentre disegni è peggio del difetto.
- I difetti del terreno (buchi d'erba nelle discese): è il blocco D3.
