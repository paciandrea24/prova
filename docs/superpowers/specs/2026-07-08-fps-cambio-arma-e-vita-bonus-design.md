# FPS — Cambio arma in-round + Vita bonus temporanea (overheal)

Data: 2026-07-08. Stato: APPROVATO.

Due feature indipendenti per il gioco FPS. File toccati:
`frontend/fps.js`, `frontend/fps.html`, `frontend/styles/fps.css`,
`backend/sockets/games/fpsGameSocket.js`.

## Analisi danno (base per la taratura del bonus)

Il danno è **costante con la distanza** (nessun falloff). Server:
`damage = weapon.damage × mutMul × (headshot ? 2 : 1)`; `range` limita solo il
raycast client. Lo shotgun è un **raycast singolo** (nessun pallettone multiplo):
danno piatto 80.

| Arma | Danno corpo | Colpi/kill (corpo, 100 HP) |
|------|-------------|-----------------------------|
| SMG | 18 | 6 |
| Assault | 25 | 4 |
| Shotgun | 80 | 2 |
| Sniper | 95 | 2 (il corpo NON one-shotta) |

Un bonus di ~30 HP dà ~1 colpo in più contro assault/SMG (combattimento standard)
e lascia intatte shotgun/sniper (80 e 95 sfondano comunque il bonus): identità armi
preservata, TTK complessivo poco alterato.

## Feature 1 — Cambio arma durante il round

- **Tasto `L`** in `phase==='playing'` + `subphase==='melee'`, giocatore vivo →
  apre l'overlay di selezione esistente in **modalità "cambio"**: niente timer di
  lancio, niente dot "ready"; il pulsante applica e chiude. Disabilitato in
  sudden death e da morto.
- **Client:** `L` rilascia il pointer lock e mostra il menu. Selezione arma →
  emette `requestWeaponChange { lobbyId, playerColor, weaponKey }` → chiude il menu
  e ri-cattura il mouse. L'arma **in mano non cambia subito**.
- **Server (`requestWeaponChange`):** valido solo se `phase==='playing'` e
  `subphase==='melee'` e `WEAPONS[weaponKey]`; imposta `game.weaponChoices[color]`.
  Non altera la vita/arma in corso.
- **Applicazione al respawn:** `respawnPlayer` deve **rileggere
  `game.weaponChoices[color]`** e aggiornare `p.weaponKey`/`p.ammo`/`p.maxAmmo`
  (oggi tiene l'arma precedente). L'evento `playerRespawn` porta già `weaponKey`,
  che il client applica via `switchWeaponModel`. La scelta persiste fino a una nuova
  richiesta o al `weapon_select` del round successivo (invariato).

## Feature 2 — Vita bonus temporanea (overheal), server-autoritativa

Costanti server: `BONUS_MAX=30`, `HP_CAP_TOTAL=130`, `BONUS_DECAY=6` (HP/s → 30→0 in 5s).
Per player: `bonusHp`, `bonusStart` (timestamp), `bonusUpdatedAt` (per il calcolo lazy).

- **Su kill** (shooter vivo, `shooter !== target`):
  `bonusHp = min(BONUS_MAX, HP_CAP_TOTAL - realHp)`; rinnovo al massimo, **mai
  accumulo**. `bonusUpdatedAt = now`.
- **Decadimento lazy (niente tick):** helper `settleBonus(p, now)` →
  `p.bonusHp = max(0, p.bonusHp - BONUS_DECAY·(now - p.bonusUpdatedAt)/1000)`,
  `p.bonusUpdatedAt = now`. Chiamato all'inizio di ogni `reportHit` e prima di
  ogni emissione. Il client anima il calo localmente (conosce rate + timestamp) e
  si risincronizza a ogni `playerHit`.
- **Danno (`reportHit`):** `settleBonus`; il danno intacca **prima `bonusHp`**,
  l'eccesso va su `realHp`. `playerHit` emette **`hp` (reale) e `bonus`**.
- **HUD:** totale = reale + bonus; barra che può superare il 100% con segmento
  bonus in colore distinto; il numero mostra il totale.
- **Reset:** morte/respawn e inizio round azzerano `bonusHp`.

### Interazione mutatori (il bonus è meccanica globale, non un mutatore)
- Visivi/movimento (moon_gravity, speed_x2, fog, giant_heads, blackout,
  mini_players, flicker_invis, blind_mode, sonar): nessuna interazione.
- **double_damage:** il danno 2× consuma il bonus più in fretta (nessun caso speciale).
- **one_in_chamber:** kill istantanea, bonus irrilevante (identità preservata).
- **headshot_only:** le headshot consumano il bonus normalmente.
- **vampirism:** la kill **prima** cura la vita reale a 100 (resta il recupero vero
  principale), **poi** applica il bonus → 130 totali. Ordine esplicito.
- **gun_game:** indipendente (avanza arma + applica bonus).

### Scope
Le healthbar sopra i nemici restano sulla **vita reale** (il bonus è feedback per il
proprio HUD).
