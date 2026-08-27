# Le facciate della città sono asset, non un disegno — design

**Data:** 2026-08-27
**Blocco:** G, dentro la fase G1 (rifinitura dopo il playtest).
**Spec madre:** `2026-08-26-f1-ambientazione-cittadina-design.md`.

## Cosa ha detto l'utente

Dopo il playtest della città col nastro texturizzato:

> «se guardiamo dal punto di vista di quanto bene il nastro chiude il circuito
> occludendo la vista e dando quel tocco di circuito cittadino, il nastro è
> perfetto. è fantastico, davvero. ma se guardiamo da un punto di vista di
> coerenza con lo stile degli asset, la simulazione di edifici che abbiamo con
> il nastro non regge il confronto. la mia idea sarebbe quella di creare delle
> facciate come asset reali e applicarle al nastro, in modo tale che seguano
> effettivamente il nastro che è perfetto nel suo lavoro. **non voglio asset di
> palazzi e poi dietro il nastro. voglio esattamente cosa c'è ora ma con delle
> facciate più coerenti con lo stile degli altri asset**.»

E prima:

> «si capisce che non sono palazzi veri. cambia il colore ma il pattern sulla
> facciata sempre quello è.»

Ambientazione scelta: **città mista, vecchia e nuova insieme**.

## La decisione

Il nastro **resta esattamente com'è** — stessa geometria, stesso profilo, stesso
mestiere: chiudere la vista senza un buco. Cambia soltanto la sua superficie:
al posto della textura disegnata su canvas si posano **moduli di facciata
modellati in Blender**, gli stessi strumenti e la stessa palette di tutti gli
altri asset del circuito (`voxelKit.py`, `circuitAssets/*.py`).

Approccio scelto fra i tre proposti: **rilievo vero su tutto il giro**. Se il
costo supera il tetto di fps, la riserva dichiarata in anticipo è degradare i
piani alti a textura tenendo il rilievo sui primi due — non rinunciare al
rilievo.

## Come una facciata segue una curva

Una facciata modellata è geometria, e la geometria piana non si piega. Si taglia
quindi in **colonne larghe 9 unità** (`CittaProfilo.MODULO_LARGO`, la stessa
misura che oggi regola la textura), posate lungo il nastro una accanto all'altra
e ruotate ciascuna secondo la normale del suo punto. È il meccanismo con cui il
progetto dispone già le file di tribune, applicato a un passo più fitto.

Ogni colonna è una **pila di tre pezzi**:

| pezzo | altezza | cosa porta |
|---|---|---|
| base | 4.5 | il piano terra: vetrine, tende, ingressi, gradini |
| piano tipo | 3.5 | ripetuto N volte: finestre, persiane, balconi, marcapiani |
| coronamento | 1.2 | cornicione aggettante, parapetto, attico |

⚠️ **L'altezza del palazzo si quantizza sulla pila**: `4.5 + N·3.5 + 1.2`, con N
da 3 a 11 — cioè da 16.2 a 44.2 unità, dentro l'intervallo di oggi (14-45). La
quantizzazione sta in `CittaProfilo`, **non** nel codice che posa i moduli: il
nastro dietro deve finire esattamente dove finisce il coronamento, e due misure
dell'altezza vorrebbero dire un coronamento che galleggia o un nastro che sbuca.

Nelle curve due colonne adiacenti sono ruotate l'una rispetto all'altra e fra
loro si apre un cuneo: su una curva di raggio 60 sono circa 0.7 unità. **Lo
tappa il nastro**, che resta dietro con il colore del palazzo — è esattamente il
lavoro per cui l'utente lo vuole tenere.

## Le famiglie

Città mista: due famiglie, scelte per palazzo con lo stesso seme deterministico
che oggi sceglie altezza e colore (dalla geometria, mai `Math.random`).

- **Vecchia** — intonaco e pietra: vetrina con tenda al piano terra, finestre
  con persiane e balconcino in ferro sul piano tipo, cornicione aggettante.
- **Nuova** — vetro e acciaio: ingresso vetrato con pensilina, nastro di vetro
  scandito da montanti, attico arretrato con parapetto.

Per non ricadere nel difetto segnalato — «il pattern sempre quello è» — ogni
famiglia ha **più varianti del piano tipo**, e la variante cambia da un palazzo
al successivo.

## Invarianti

- Le piste **senza** `ambientazione: "citta"` non cambiano di un vertice.
- Il nastro resta e continua a chiudere: niente cielo fra due colonne.
- L'invariante già in vigore vale anche per le facciate: **niente di bordo pista
  finisce dentro un palazzo** (`scenografiaInvarianti.test.js`), e la corsia box
  resta libera.
- Le facciate **non hanno ruolo fisico**: il muro contro cui si sbatte resta la
  barriera. Non entrano nel registro degli ingombri della scenografia.
- ⚠️ **Gate sugli asset**: i render dei moduli vanno approvati dall'utente
  **prima** di cablarli in gioco.

## Il costo

Stima da verificare, non da assumere: ~530 colonne per circuito (due lati di un
giro da 2400 unità), 5-7 pezzi per colonna, cioè circa 2.600 istanze. Le draw
call restano poche (un `InstancedMesh` per mesh-colore di ogni modulo), i
triangoli crescono di qualche centinaio di migliaia.

**Il tetto lo misura l'utente col pannello F9**, prima e dopo, sulla stessa
pista. Se sfora, si degrada come detto sopra.
