# F1 — Barriere: il muro smette di annodarsi (vincolo geometrico)

Data: 2026-08-12
Branch: `f1-ghiaia` (worktree `.claude/worktrees/f1-ghiaia`), da `0586fc8`

## Il problema

In gioco, in quattro punti di `prova`, la barriera forma un ammasso di facce
che si compenetrano: un origami rosso e bianco in mezzo al prato, con lembi
che puntano in direzioni scorrelate dalla pista. L'utente lo chiama "groviglio"
e lo ha segnalato tre volte, ai campioni 132, 337, 646 e 764.

Tre tentativi di correzione hanno fallito il playtest, due sono stati
revertati. Tutti e tre lavoravano sul **profilo di distanza** del muro
(livellarlo, aprirlo morfologicamente, abbassarlo da 20 a 16). Nessuno poteva
funzionare, perché il difetto non è un problema di taratura.

## La causa, misurata

La barriera è la pista spostata di lato: per ogni campione della centerline,
`buildBarriers` (`trackMeshBuilder.js:378-390`) piazza un vertice a distanza
`d` lungo la normale. Sul **lato interno** di una curva quel vertice descrive
un cerchio di raggio `R − d`. Se `d ≥ R` il raggio diventa negativo: i vertici
consecutivi si scavalcano, il nastro indietreggia invece di avanzare e si
annoda. È aritmetica, non una soglia da tarare.

Misura sui quattro tracciati con `0586fc8` caricato (muro a 29.8 dall'asse):

| tracciato    | campioni con `d ≥ R` | curva peggiore                     |
|--------------|----------------------|------------------------------------|
| prova        | 12                   | camp. 134: raggio 21.1, muro 29.8  |
| new-monza    | 18                   | camp. 365: raggio 21.3, muro 32.8  |
| baku         | 17                   | raggio 9.9, muro 13                |
| monte-rosso  | 0                    | massimo `d/R` = 0.64               |

Le zone annodate su `prova` sono i campioni 130-137, 333-340, 644-649 e
760-768: **gli stessi quattro punti marcati in gioco col tasto M**. E
`monte-rosso`, l'unico tracciato che non ha mai dato problemi, è l'unico con
zero campioni oltre il limite. La corrispondenza regge in entrambi i versi.

Abbassare `RUNOFF_MIN` da 20 a 16 non elimina la classe di difetto: sposta la
soglia. Con una curva di raggio 21, anche 16 è troppo.

## La regola decisa

Decisa dall'utente il 2026-08-12, in questi termini: *"16 ovunque tranne nelle
curve che in base alla velocità ne necessitano di più. Da controllare in ogni
punto se 16 o più è compatibile col non far spuntare i difetti nelle barriere.
In questi ultimi casi si riduce fino a farli scomparire."*

1. **Base 16 dal cordolo** su tutto il giro (`RUNOFF_MIN`, invariato).
2. **La ghiaia può spingere il muro oltre 16**, con la larghezza che ogni curva
   chiede in base al proprio raggio minimo — cioè alla velocità di
   percorrenza. Si **rimuove `RUNOFF_MAX`**, il tetto fisso introdotto ieri.
   Su `prova` le curve tornano a chiedere 20.7, 22, 25.1 e 31.9 unità dove oggi
   sono tutte tosate a 16.
3. **Un tetto geometrico per campione** prende il posto di quel tetto fisso.
   Non è un numero scelto: si ricava in forma chiusa dalla stessa espressione
   con cui la mesh piazza i vertici, imponendo che il nastro avanzi di almeno
   una frazione dell'avanzamento della pista. Dove morde, il muro scende — fino
   ad abbracciare il cordolo nei tornanti stretti.
4. **Nessun tracciato peggiora**: la ghiaia non spinge dove il tetto geometrico
   è già sotto la distanza attuale.

Il risultato voluto è un muro che *racconta* la pista: largo con ghiaia nelle
curve veloci, stretto sul cordolo nei tornanti, 16 sui rettilinei.

### Il tetto, in forma chiusa

L'avanzamento del nastro fra il campione `prev` e il campione `i`, proiettato
sulla tangente in `prev`, vale `A + C·d` dove:

- `A` = avanzamento della centerline fra i due campioni;
- `C = side · (N_i · T_prev)`, negativo sul lato interno;
- `d` = distanza del muro **al campione di arrivo** `i`.

Si impone `A + C·d ≥ MIN_ADVANCE · A`, da cui `d ≤ A·(1 − MIN_ADVANCE) / (−C)`.
Con `MIN_ADVANCE = 0.35` i quad restano non degeneri e resta margine per il
campionamento.

⚠️ Il tetto va applicato al campione di **arrivo**, non a quello di partenza:
la normale di partenza è per costruzione perpendicolare alla propria tangente,
quindi la sua distanza non entra nell'avanzamento. Sbagliarlo sembra
funzionare su `prova` (campioni vicini hanno distanze simili) e lascia 31
ripiegamenti su `baku`.

Questa formula esiste già: è il commit `ec58bdb`, revertato il 2026-08-12
**in blocco** insieme al fix colpevole del playtest fallito (`3b0331a`), non
perché sbagliata. Va recuperata da lì, non riscritta.

### Come si applica il tetto: due varianti, si sceglie sul disegno

- **secco per campione**: si abbassa solo il campione che sfora;
- **per arco di curva**: se il tetto morde in un punto della curva, si abbassa
  l'intero arco al valore compatibile, con raccordi lunghi in entrata e uscita.

Sui numeri di `prova` sono equivalenti (entrambe 0 ripiegamenti, 0
auto-intersezioni); su `new-monza` la seconda tocca 202 campioni contro 81.
Cambiano la **forma**, che è ciò che giudica l'utente: il clamp secco è già
stato descritto come "uncino" e scartato una volta. La scelta si fa guardando
i disegni dall'alto, prima di toccare il gioco.

## Risultato atteso, simulato prima di scrivere il fix

Regola simulata sui dati veri (`MIN_ADVANCE = 0.35`, ghiaia libera oltre 16):

| tracciato    | oggi (cuspidi, incroci) | con la regola |
|--------------|-------------------------|---------------|
| prova        | 10, 10                  | **0, 0**      |
| new-monza    | 23, 10                  | 2, 1          |
| monte-rosso  | 0, 0                    | 0, 0          |
| baku         | 31, 13                  | non peggio di oggi (vedi sotto) |

Su `baku` la simulazione **senza** la clausola 4 dà 45 e 37, cioè peggio di
oggi: è la ghiaia che spinge il muro in curve dove nemmeno la distanza storica
ci stava. È la misura che ha reso necessaria quella clausola, ed è il primo
numero che il test dovrà sorvegliare.

## Il limite noto: baku

Su `baku` le curve hanno raggio **9.9** mentre la pista ha semi-larghezza
**11**: il centro di curvatura cade dentro l'asfalto. Nessuna barriera interna
è geometricamente possibile, a nessuna distanza — il difetto esisteva già col
muro storico (46 ripiegamenti prima di tutto il lavoro sulle vie di fuga).

Non si cura con questa regola. Si cura allargando quelle curve nell'editor,
oppure si accetta. La spec lo mette per iscritto come **limite del tracciato**
e il test lo fissa come "non peggiora", non come "zero".

## Verifica: il disegno prima del playtest

Il pezzo mancato tutte e tre le volte non è stato il codice, è stato il
controllo: le misure dicevano "verde" mentre l'occhio dell'utente diceva
"peggio". Quindi:

- **Primo task, non ultimo**: uno strumento
  `backend/tools/f1-barriera-dallalto.js` che disegna il muro visto dall'alto
  dai dati veri, con le zone critiche evidenziate e il prima/dopo affiancati.
- Il disegno lo guarda Claude **prima** di consegnare, e viene mostrato
  all'utente come pagina sfogliabile.
- Le due varianti di applicazione del tetto si scelgono lì.

### Invarianti automatiche

Nuovi test in `trackGravel.test.js`:

- `prova` e `monte-rosso`: **0** ripiegamenti e **0** auto-intersezioni locali;
- `new-monza`: non oltre i valori di oggi;
- `baku`: non oltre i valori di oggi, con il motivo scritto nel test.

Da non rompere:

- `trackLoader.test.js` — profilo client e server identici campione per
  campione, altrimenti in gioco si sbatte contro muri invisibili;
- i quattro test di `backend/tools/f1-segnalazioni.test.js` — layout della
  scenografia identico fra tool e client;
- i **4 test rossi preesistenti** su 761 restano rossi e non sono di questo
  lavoro (Simcade isolamento componenti, i due `loadTrack("monte-rosso")`,
  `simulateLap` col preset di tuning).

### Verifiche a occhio, elencate

- il muro non si annoda in nessuno dei quattro punti segnalati;
- la ghiaia è visibilmente più larga nelle curve veloci che in quelle lente;
- nei tornanti il muro sta sul cordolo senza punte o uncini;
- tribune e reti, che leggono lo stesso profilo, **si spostano in fuori
  insieme al muro**: vanno controllate non staccate e non appese al terrapieno.

## Cosa resta fuori

- Gli altri tre difetti marcati in gioco: tenda del paddock dentro i garage
  (camp. 23), passerella nella ghiaia (camp. 408), tribuna storta (camp. 620).
  Restano annotati, con un playtest dedicato dopo — un difetto di scenografia
  non deve mascherare un difetto del muro.
- L'attrito della ghiaia, identico all'erba per scelta esplicita dell'utente.
- Il tratto traguardo/box, che resta com'è su entrambi i lati.
- I ponti, dove il muro resta a bordo strada.
- La geometria della barriera come polilinea propria (parametrizzazione
  separata dalla pista): sarebbe la soluzione formalmente completa, cura anche
  `baku`, ma tocca tutti e quattro i consumatori del profilo, muro fisico lato
  server compreso. Scartata per ora come sproporzionata.

## Note di processo

- Un commit per task, per avere punti di ripristino fra un playtest e l'altro.
  Il push resta manuale dell'utente.
- Bump del cache-busting in `f1.html` ad ogni modifica JS, altrimenti il
  browser serve il file vecchio e sembra che nulla sia cambiato.
- Il server va riavviato dopo modifiche al backend.
