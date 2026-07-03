# Design — Armi cartoon curve (G4.1), 2026-07-03

Redesign delle 4 armi FPS: l'utente le trova **troppo squadrate**. Scelte approvate in brainstorming:
- **Ridisegno curvo** (non semplice smussatura): linguaggio di forme anni '30/Cuphead.
- **Approccio A**: solidi di rivoluzione (`LatheGeometry`) + tubi curvi (`TubeGeometry` su
  `CatmullRomCurve3`) + ellissoidi (sfere scalate). Tutte geometrie core r128 con normali smooth
  → i contorni inverted-hull (`_toonDisplacedGeo`) non si aprono. Niente ExtrudeGeometry
  (spigoli duri → contorni glitchati), niente RoundedBox (dipendenza CDN, resta squadrato).
- **Verifica in viewer dedicato** prima del trapianto in gioco: `frontend/fps-armi-proto.html|js`.

## Linguaggio di forme comune
- Calci "a pera" (profilo che si gonfia verso il calciolo), mai parallelepipedi.
- Canne affusolate verso la volata, anelli d'ottone come snodi.
- Impugnature "a banana" (tubi curvi in legno).
- Palette invariata: legno chiaro/scuro, blu-metallo, ottone + contorni inchiostro per-istanza.

## Le 4 armi
- **SMG = Thompson M1928 toon** (richiesta esplicita dell'utente): ricevitore a sezione
  arrotondata col dorso tondo, leva d'armamento in ottone sul dorso, canna con **alette di
  raffreddamento** (pila di anelli) chiusa dal **compensatore Cutts** svasato, **tamburo da 50
  colpi** panciuto con perno d'ottone, doppia impugnatura in legno curva (pistol grip + foregrip
  verticale), **calcio col "drop"** discendente, panciuto, calciolo d'ottone.
- **Shotgun**: blunderbuss doppietta — volata a tromba esagerata (elemento comico principale),
  astina panciuta, calcio a pera con guancia gonfia, cane a virgola in ottone.
- **Sniper**: canna lunghissima quasi a spillo con volata svasata, corpo in legno fluido,
  scopone sproporzionato a botte con ghiere d'ottone e lente celeste, otturatore a sferetta
  con levetta curva.
- **Assault**: castello bombato a capsula, caricatore a banana **davvero curvo** (tubo su arco),
  paramano in legno gonfio, calcio a pera, mirino a sferetta d'ottone su volata svasata.

## Vincoli tecnici (contratto invariato di `buildToonWeaponModel(key)` in fps.js)
- Origine al grip, canna verso **-Z**, calcio a +Z; unico builder FP+TP.
- Materiali (`makeToonMat`) e ink **per-istanza** (mutatore Fantasmi / `setGroupOpacity`).
- Ingombri simili agli attuali così `_FP_CFG` e scala TP 0.8 restano una base valida.
- Segmenti radiali contenuti (12–16). Contorni: ramo displacement di `_addToonOutline`.

## Viewer (`frontend/fps-armi-proto.html|js`)
Pagina standalone (Three r128 da cdnjs, core only → mini-orbit custom, non OrbitControls):
4 armi su piedistalli girevoli, sfondo neutro, drag per orbitare + rotella per zoom, bottoni
per mettere a fuoco ogni arma. Gli helper toon (gradMap, grain, makeToonMat, _toonDisplacedGeo,
_addToonOutline, TOON_OUTLINE_T=0.008) sono copiati IDENTICI da fps.js così il trapianto non
riserva sorprese. Niente emoji nell'UI (regola utente).

## Flusso
1. Viewer + 4 armi nuove → l'utente approva arma per arma nel viewer.        ← FATTO/IN CORSO
2. Trapianto del nuovo `buildToonWeaponModel` in fps.js (FP+TP), verifica localhost 2 tab.
3. Ritocco pose `_FP_CFG` se qualche grip non cade più nel guantone.
4. Aggiornare `docs/fps-notes.md` (sezione "Armi cartoon procedurali").

NB progetto: niente commit/push senza richiesta esplicita dell'utente.
