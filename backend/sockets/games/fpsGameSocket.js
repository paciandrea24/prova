// backend/sockets/games/fpsGameSocket.js
const { lobbies, destroyTimers } = require('../../store/lobbies');
const { activeGames } = require('../../store/activeGames');

const GAME_ID = 'fps';

// Configurazione armi
const WEAPONS = {
    assault: { name: 'Assault Rifle', damage: 25, fireRate: 150, range: 80, ammo: 30, reload: 2000, spread: 0.03, auto: true },
    smg: { name: 'SMG', damage: 18, fireRate: 80, range: 40, ammo: 45, reload: 1500, spread: 0.06, auto: true },
    shotgun: { name: 'Shotgun', damage: 80, fireRate: 900, range: 20, ammo: 8, reload: 2500, spread: 0.15, auto: false },
    sniper: { name: 'Sniper Rifle', damage: 95, fireRate: 1500, range: 150, ammo: 5, reload: 3000, spread: 0.005, auto: false }
};

// Spawn points — MONDO ESTESO (Jazz + Galleria cuciti). Jazz: 8 in corsia
// esterna (r≈38.5) + 2 interna (r≈20), rivolti verso l'origine. Galleria: 7 lungo
// i bracci della croce (offset mondo x+97), rivolti verso il centro Galleria (97,0).
// Convenzione: forward = (-sin angle, -cos angle) → angle = atan2(x-cx, z-cz)
// guarda il centro (cx,cz). Con ?map=jazz (debug) valgono solo i primi 10.
const SPAWN_POINTS = [
    { x:     0, y: 0, z: -38.5, angle: Math.atan2(0, -38.5) },     // Jazz corsia 2, nord
    { x:  27.2, y: 0, z: -27.2, angle: Math.atan2(27.2, -27.2) },  // Jazz corsia 2, NE
    { x:  38.5, y: 0, z:     0, angle: Math.atan2(38.5, 0) },      // Jazz corsia 2, est
    { x:  27.2, y: 0, z:  27.2, angle: Math.atan2(27.2, 27.2) },   // Jazz corsia 2, SE
    { x:     0, y: 0, z:  38.5, angle: Math.atan2(0, 38.5) },      // Jazz corsia 2, sud
    { x: -27.2, y: 0, z:  27.2, angle: Math.atan2(-27.2, 27.2) },  // Jazz corsia 2, SO
    { x: -38.5, y: 0, z:     0, angle: Math.atan2(-38.5, 0) },     // Jazz corsia 2, ovest
    { x: -27.2, y: 0, z: -27.2, angle: Math.atan2(-27.2, -27.2) }, // Jazz corsia 2, NO
    { x:     0, y: 0, z: -20,   angle: Math.atan2(0, -20) },       // Jazz corsia 1, nord
    { x:     0, y: 0, z:  20,   angle: Math.atan2(0, 20) },        // Jazz corsia 1, sud
    // — GALLERIA (centro a 97,0) —
    { x:  97, y: 0, z: -18, angle: Math.atan2(97 - 97, -18) },     // braccio nord
    { x:  97, y: 0, z: -26, angle: Math.atan2(97 - 97, -26) },     // braccio nord (fondo)
    { x:  97, y: 0, z:  18, angle: Math.atan2(97 - 97,  18) },     // braccio sud
    { x:  97, y: 0, z:  26, angle: Math.atan2(97 - 97,  26) },     // braccio sud (fondo)
    { x:  79, y: 0, z:   0, angle: Math.atan2(79 - 97,   0) },     // braccio ovest (verso i corridoi)
    { x:  85, y: 0, z:   0, angle: Math.atan2(85 - 97,   0) },     // braccio ovest (interno)
    { x: 115, y: 0, z:   0, angle: Math.atan2(115 - 97,  0) },     // braccio est (fondo sigillato)
    // — PIAZZA DELLA FONTANA (ovale centro 55.5,0) —
    { x: 55.5, y: 0, z: -13, angle: Math.PI },  // estremo nord, guarda la fontana (+z)
    { x: 55.5, y: 0, z:  13, angle: 0 },        // estremo sud, guarda la fontana (−z)
    // — FUNLAND (luna park nord, recinto x 38..88 / z -52..-18): rivolti alla giostra (56,-34) —
    { x: 55.5, y: 0, z: -21, angle: Math.atan2(55.5 - 56, -21 + 34) },  // gola d'ingresso
    { x: 44,   y: 0, z: -40, angle: Math.atan2(44 - 56,   -40 + 34) },  // tiro a segno
    { x: 78,   y: 0, z: -44, angle: Math.atan2(78 - 56,   -44 + 34) },  // base ruota
    { x: 84,   y: 0, z: -27, angle: Math.atan2(84 - 56,   -27 + 34) }   // bordo pista autoscontro
];

const PLAYER_HP = 100;
const WEAPON_SELECT_TIME = 20000; // 20 secondi per scegliere l'arma (solo round 1)
const ROUND_END_DELAY = 2500;     // pausa breve tra un round e l'altro (pacing "ancora una")
const ROUND_INTRO_TIME = 3500;    // fase INTRO a inizio round: gioco congelato, pannello di preparazione
const MELEE_DURATION = 45000;     // durata fase MISCHIA (respawn istantaneo) prima del sudden death
const FPS_ROUNDS = 5;             // round fissi per partita
const RESPAWN_DELAY = 1500;       // ritardo prima di rinascere in mischia
const REJOIN_GRACE = 60000;       // finestra di riconnessione dopo un drop (schede in background
                                  // congelate dal browser) prima della rimozione definitiva

// Mutatori v1: il server ne pesca uno a caso (senza ripetere l'ultimo) a ogni round.
// Sono tutti effetti CLIENT-side: il server comunica solo l'id, il client applica l'effetto.
// 14 mutatori attivi: 8 base + 6 dell'espansione (vampirism/headshot_only/flicker_invis/blind_mode/sonar/gun_game).
const MUTATORS = ['moon_gravity', 'speed_x2', 'fog', 'giant_heads', 'blackout', 'double_damage', 'one_in_chamber', 'mini_players',
    'vampirism', 'headshot_only', 'flicker_invis', 'blind_mode', 'sonar', 'gun_game'];

// Gun Game: progressione armi. Ogni kill fa avanzare il killer al passo successivo (cicla).
const GUN_GAME_LADDER = ['smg', 'assault', 'shotgun', 'sniper'];

// Moltiplicatore danno per mutatore (server autoritativo)
const DMG_MUL = { double_damage: 2, one_in_chamber: 100 };

const MAX_TROPHIES = 60;          // cap teste-trofeo sul campo (rimuove la più vecchia oltre il limite)

// Punteggio "a teste": ogni kill vale punti, vincere il sudden death dà un bonus.
const POINTS_PER_KILL = 1;        // punti per ogni uccisione (mischia E sudden death)
const SD_WIN_BONUS = 5;           // bonus punti per chi vince il sudden death del round
const HEADSHOT_MUL = 2;           // moltiplicatore danno sulle headshot (taratura in localhost)

// Vita bonus temporanea (overheal): ogni kill dà un cuscinetto di vita SEPARATO
// dalla vita reale, consumato PRIMA di essa e decaduto nel tempo. Taratura sul
// danno al corpo (assault 25 / smg 18): ~30 = un colpo in più contro i fucili
// standard, ininfluente su shotgun/sniper (80/95 sfondano comunque il bonus).
const BONUS_MAX = 30;             // valore a cui la kill riporta il bonus (mai accumulo)
const HP_CAP_TOTAL = 130;         // tetto alla vita totale (reale + bonus)
const BONUS_DECAY = 6;            // HP/secondo di decadimento (30 → 0 in ~5s)

// Decadimento "lazy" del bonus: lo assesta al tempo `now` senza bisogno di un tick.
// Va chiamata prima di leggere/modificare p.bonusHp.
function settleBonus(p, now) {
    if (!p || !p.bonusHp) { if (p) p.bonusUpdatedAt = now; return; }
    const dt = Math.max(0, now - (p.bonusUpdatedAt || now)) / 1000;
    p.bonusHp = Math.max(0, p.bonusHp - BONUS_DECAY * dt);
    p.bonusUpdatedAt = now;
}

module.exports = function (io, socket) {

    // ──────────────────────────────────────────
    // AVVIO DAL LOBBY
    // ──────────────────────────────────────────
    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;
        if (gameId !== GAME_ID) return;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        lobby.gameSettings = settings;
        io.to(lobbyId).emit('gameSelected', { gameId, settings });
    });

    // ──────────────────────────────────────────
    // JOIN GAME
    // ──────────────────────────────────────────
    socket.on('joinFPS', (data) => {
        const { lobbyId, playerColor } = data;
        socket.join(lobbyId);
        socket.data.lobbyId = lobbyId;
        socket.data.color = playerColor;
        socket.data.joinedFPS = true;   // marca: questo socket è in partita FPS

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        // Cancella il timer di distruzione lobby impostato quando i giocatori
        // hanno navigato dalla lobby alla pagina FPS (i vecchi socket si sono disconnessi).
        if (destroyTimers.has(lobbyId)) {
            clearTimeout(destroyTimers.get(lobbyId));
            destroyTimers.delete(lobbyId);
            console.log(`♻️ Destroy timer annullato (joinFPS) per lobby ${lobbyId}`);
        }

        // Il vecchio socket (lobby) si è disconnesso e ha rimosso il player da lobby.players.
        // Lo reinseriamo qui affinché launchRound lo trovi.
        if (!lobby.players.includes(playerColor)) {
            lobby.players.push(playerColor);
        }

        // Inizializza partita se non esiste
        if (!activeGames.has(lobbyId)) {
            const totalRounds = FPS_ROUNDS; // valore fisso (5): la lobby non lo configura più

            const game = {
                gameId: GAME_ID,
                phase: 'weapon_select', // weapon_select | playing | round_end | game_over
                subphase: null,          // in 'playing': 'melee' | 'suddendeath'
                mutator: null,           // mutatore del round corrente
                lastMutator: null,       // per evitare ripetizioni consecutive
                trophyHeads: [],         // teste-trofeo persistenti (NON resettate tra i round)
                totalRounds,
                currentRound: 1,
                scores: {},              // color -> wins (vittorie sudden death del round)
                points: {},              // color -> punti totali (teste): metrica principale
                players: {},              // color -> playerState
                weaponChoices: {},              // color -> weaponKey
                confirmedCount: 0,
                selectTimer: null,
                phaseTimer: null,        // timer mischia -> sudden death
                respawnTimers: {},       // color -> timeout di respawn (mischia)
                aliveCount: 0
            };

            lobby.players.forEach(c => {
                game.scores[c] = 0;
                game.points[c] = 0;
                game.weaponChoices[c] = 'assault';
            });

            activeGames.set(lobbyId, game);
            startWeaponSelect(io, lobbyId);
        }

        const game = activeGames.get(lobbyId);

        // Riconnessione entro la grazia: annulla la rimozione definitiva
        if (game.rejoinTimers && game.rejoinTimers[playerColor]) {
            clearTimeout(game.rejoinTimers[playerColor]);
            delete game.rejoinTimers[playerColor];
            console.log(`♻️ [FPS] ${playerColor} riconnesso entro la grazia (phase=${game.phase})`);
        }

        // Giocatore entrato dopo la creazione del game: aggiunge scores/choices mancanti
        if (!game.scores.hasOwnProperty(playerColor)) {
            game.scores[playerColor] = 0;
            game.points[playerColor] = 0;
            game.weaponChoices[playerColor] = 'assault';
        }

        // RIENTRO IN CORSA (riconnessione dopo un drop, es. scheda congelata dal
        // browser): se il round è in corso e il player non ha più un'entry viva,
        // lo si reintegra. In MISCHIA rientra subito vivo su uno spawn (come un
        // respawn); in SUDDEN DEATH rientra da morto e aspetta il prossimo round.
        if (game.phase === 'playing' && (!game.players[playerColor] || game.players[playerColor].dead)) {
            const weaponKey = game.weaponChoices[playerColor] || 'assault';
            const weapon = WEAPONS[weaponKey];
            const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
            const rientraVivo = game.subphase === 'melee';
            game.players[playerColor] = {
                color: playerColor,
                hp: PLAYER_HP,
                bonusHp: 0,
                bonusUpdatedAt: 0,
                dead: !rientraVivo,
                x: spawn.x, y: spawn.y, z: spawn.z,
                angle: spawn.angle,
                weaponKey,
                ammo: weapon.ammo,
                maxAmmo: weapon.ammo
            };
            if (rientraVivo) {
                // Notifica gli altri client: fa rivivere/riposizionare la mesh remota
                io.to(lobbyId).emit('playerRespawn', {
                    color: playerColor,
                    x: spawn.x, y: spawn.y, z: spawn.z, angle: spawn.angle,
                    hp: PLAYER_HP,
                    weaponKey,
                    ammo: weapon.ammo
                });
            }
        }

        // Aggiorna tutti i client sul totale giocatori (conta corretta per il countdown armi)
        if (game.phase === 'weapon_select') {
            const confirmedCount = game._confirmed ? game._confirmed.size : 0;
            io.to(lobbyId).emit('playerConfirmed', {
                playerColor,
                count: confirmedCount,
                total: lobby.players.length
            });
        }

        // Invia stato attuale al giocatore appena connesso
        socket.emit('fpsInit', {
            phase: game.phase,
            subphase: game.subphase,
            mutator: game.mutator,
            trophyHeads: game.trophyHeads,
            currentRound: game.currentRound,
            totalRounds: game.totalRounds,
            scores: game.scores,
            points: game.points,
            players: game.players,
            weapons: WEAPONS,
            myColor: playerColor,
            hostColor: lobby.host
        });

        // WebRTC signaling: notifica agli altri peer
        socket.to(lobbyId).emit('peerJoined', { color: playerColor, socketId: socket.id });

        // Invia lista peer esistenti al nuovo arrivato
        const peers = [];
        for (const [sid, s] of io.sockets.sockets) {
            if (s.data.lobbyId === lobbyId && sid !== socket.id) {
                peers.push({ color: s.data.color, socketId: sid });
            }
        }
        socket.emit('existingPeers', peers);
    });

    // ──────────────────────────────────────────
    // WebRTC SIGNALING (passthrough)
    // ──────────────────────────────────────────
    socket.on('rtcOffer', ({ targetSocketId, sdp }) => {
        io.to(targetSocketId).emit('rtcOffer', { fromSocketId: socket.id, sdp });
    });

    socket.on('rtcAnswer', ({ targetSocketId, sdp }) => {
        io.to(targetSocketId).emit('rtcAnswer', { fromSocketId: socket.id, sdp });
    });

    socket.on('rtcIceCandidate', ({ targetSocketId, candidate }) => {
        io.to(targetSocketId).emit('rtcIceCandidate', { fromSocketId: socket.id, candidate });
    });

    // ──────────────────────────────────────────
    // SELEZIONE ARMA
    // ──────────────────────────────────────────
    socket.on('chooseWeapon', ({ lobbyId, playerColor, weaponKey }) => {
        const game = activeGames.get(lobbyId);
        if (!game || game.phase !== 'weapon_select') return;
        if (!WEAPONS[weaponKey]) return;

        game.weaponChoices[playerColor] = weaponKey;
        io.to(lobbyId).emit('weaponChosen', { playerColor, weaponKey });
    });

    socket.on('confirmWeapon', ({ lobbyId, playerColor }) => {
        const game = activeGames.get(lobbyId);
        if (!game || game.phase !== 'weapon_select') return;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        if (!game._confirmed) game._confirmed = new Set();
        if (game._confirmed.has(playerColor)) return;
        game._confirmed.add(playerColor);

        io.to(lobbyId).emit('playerConfirmed', { playerColor, count: game._confirmed.size, total: lobby.players.length });

        if (game._confirmed.size >= lobby.players.length) {
            clearTimeout(game.selectTimer);
            launchRound(io, lobbyId);
        }
    });

    // ──────────────────────────────────────────
    // CAMBIO ARMA DURANTE IL ROUND (feature "loadout")
    // La richiesta ha effetto al PROSSIMO respawn: aggiorna solo la scelta
    // persistente (weaponChoices), non l'arma della vita in corso. Consentito
    // solo in MISCHIA (in sudden death non c'è respawn).
    // ──────────────────────────────────────────
    socket.on('requestWeaponChange', ({ lobbyId, playerColor, weaponKey }) => {
        const game = activeGames.get(lobbyId);
        if (!game || game.phase !== 'playing' || game.subphase !== 'melee') return;
        if (!WEAPONS[weaponKey]) return;

        game.weaponChoices[playerColor] = weaponKey;
        // L'arma comparirà al prossimo respawn (respawnPlayer rilegge weaponChoices).
    });

    // ──────────────────────────────────────────
    // STATO GIOCATORE (autoritativo lato client,
    // broadcast agli altri tramite WebRTC data channel.
    // Il server riceve solo eventi critici)
    // ──────────────────────────────────────────
    socket.on('playerState', (data) => {
        // Relay dello stato posizione/rotazione via socket come fallback
        // (i client useranno preferibilmente il data channel WebRTC)
        const { lobbyId } = data;
        socket.to(lobbyId).emit('playerState', data);

        // Memorizza l'ultima posizione nota (autoritativa "abbastanza" per i trofei):
        // così alla morte in sudden death sappiamo dove piantare la testa.
        const game = activeGames.get(lobbyId);
        if (game && game.players && data.color && game.players[data.color]) {
            const p = game.players[data.color];
            if (typeof data.x === 'number') p.x = data.x;
            if (typeof data.y === 'number') p.y = data.y;
            if (typeof data.z === 'number') p.z = data.z;
            if (typeof data.ry === 'number') p.angle = data.ry;
        }
    });

    // ──────────────────────────────────────────
    // HIT DETECTION (server autoritativo)
    // ──────────────────────────────────────────
    socket.on('reportHit', (data) => {
        const { lobbyId, shooterColor, targetColor, weaponKey, headshot } = data;
        const game = activeGames.get(lobbyId);
        // DIAGNOSTICA: ogni colpo rifiutato viene loggato col motivo (i colpi
        // al corpo in "Solo Headshot" sono regola di gioco, non li logghiamo)
        const rej = (motivo) => console.log(
            `🚫 [FPS] hit rifiutato: ${shooterColor} → ${targetColor} (${weaponKey})` +
            ` — ${motivo} [phase=${game ? game.phase : 'NO_GAME'} sub=${game ? game.subphase : '-'} mut=${game ? game.mutator : '-'}]`);
        if (!game || game.phase !== 'playing') { rej(game ? 'fase non playing' : 'partita inesistente'); return; }

        const target = game.players[targetColor];
        if (!target) { rej('bersaglio ASSENTE dal game'); return; }
        if (target.dead) { rej('bersaglio già morto lato server'); return; }

        const weapon = WEAPONS[weaponKey];
        if (!weapon) { rej('arma sconosciuta'); return; }

        // Solo Headshot: i colpi al corpo non fanno danno
        if (game.mutator === 'headshot_only' && !headshot) return;

        // Danno = base × moltiplicatore mutatore (double_damage / one_in_chamber) × headshot
        const mutMul = DMG_MUL[game.mutator] || 1;
        const damage = weapon.damage * mutMul * (headshot ? HEADSHOT_MUL : 1);

        // Overheal: il danno consuma PRIMA la vita bonus (assestata al tempo attuale),
        // poi l'eccedenza intacca la vita reale.
        const now = Date.now();
        settleBonus(target, now);
        let remaining = damage;
        if (target.bonusHp > 0) {
            const absorbed = Math.min(target.bonusHp, remaining);
            target.bonusHp -= absorbed;
            remaining -= absorbed;
        }
        target.hp -= remaining;

        io.to(lobbyId).emit('playerHit', {
            targetColor,
            hp: Math.max(0, target.hp),
            bonus: Math.max(0, target.bonusHp),
            shooterColor,
            damage,
            headshot: !!headshot
        });

        if (target.hp <= 0) {
            target.dead = true;
            console.log(`☠ [FPS] kill: ${shooterColor} → ${targetColor} (sub=${game.subphase}, mut=${game.mutator})`);

            // Punti "a teste": ogni kill vale POINTS_PER_KILL al killer (no autogol)
            if (shooterColor && shooterColor !== targetColor) {
                game.points[shooterColor] = (game.points[shooterColor] || 0) + POINTS_PER_KILL;

                // Ricompensa in vita per il killer (se vivo):
                //  - Vampirismo: RECUPERO REALE della vita a pieno (resta il metodo
                //    principale per curarsi davvero).
                //  - Overheal (sempre): la vita bonus viene riportata al massimo
                //    (min(BONUS_MAX, tetto - vita reale); mai accumulo). Applicato
                //    DOPO l'eventuale cura vampirismo.
                const sh = game.players[shooterColor];
                if (sh && !sh.dead) {
                    const now = Date.now();
                    if (game.mutator === 'vampirism') sh.hp = PLAYER_HP;
                    settleBonus(sh, now);
                    sh.bonusHp = Math.min(BONUS_MAX, Math.max(0, HP_CAP_TOTAL - sh.hp));
                    sh.bonusUpdatedAt = now;
                    io.to(lobbyId).emit('playerHit', {
                        targetColor: shooterColor, hp: sh.hp, bonus: sh.bonusHp,
                        shooterColor, damage: 0, heal: true
                    });
                }

                // Gun Game: ogni kill fa avanzare l'arma del killer lungo la progressione.
                // Aggiorna weaponKey (usato dal respawn) E weaponChoices (persiste nel round).
                if (game.mutator === 'gun_game') {
                    const sh = game.players[shooterColor];
                    if (sh) {
                        const idx = GUN_GAME_LADDER.indexOf(sh.weaponKey);
                        const next = GUN_GAME_LADDER[(idx + 1) % GUN_GAME_LADDER.length];
                        const w = WEAPONS[next];
                        sh.weaponKey = next;
                        sh.ammo = w.ammo;
                        sh.maxAmmo = w.ammo;
                        game.weaponChoices[shooterColor] = next;
                        io.to(lobbyId).emit('weaponSwitch', {
                            color: shooterColor, weaponKey: next, ammo: w.ammo, maxAmmo: w.ammo
                        });
                    }
                }
            }

            io.to(lobbyId).emit('playerKilled', {
                killedColor: targetColor,
                killerColor: shooterColor,
                aliveCount: game.aliveCount,
                subphase: game.subphase,
                points: game.points
            });

            if (game.subphase === 'melee') {
                // MISCHIA: morte temporanea → respawn istantaneo, il round NON finisce
                if (!game.respawnTimers) game.respawnTimers = {};
                if (game.respawnTimers[targetColor]) clearTimeout(game.respawnTimers[targetColor]);
                game.respawnTimers[targetColor] = setTimeout(() => {
                    respawnPlayer(io, lobbyId, targetColor);
                }, RESPAWN_DELAY);
            } else {
                // SUDDEN DEATH: eliminazione definitiva + testa-trofeo sul punto di morte
                game.aliveCount--;
                const pos = game.players[targetColor];
                if (pos) {
                    game.trophyHeads.push({ color: targetColor, x: pos.x, y: pos.y, z: pos.z });
                    if (game.trophyHeads.length > MAX_TROPHIES) game.trophyHeads.shift();
                }
                checkRoundEnd(io, lobbyId);
            }
        }
    });

    // ──────────────────────────────────────────
    // CHAT IN-GAME
    // ──────────────────────────────────────────
    socket.on('fpsChat', ({ lobbyId, playerColor, message }) => {
        io.to(lobbyId).emit('fpsChat', { playerColor, message, ts: Date.now() });
    });

    // ──────────────────────────────────────────
    // RETURN TO LOBBY (host)
    // ──────────────────────────────────────────
    socket.on('fpsReturnToLobby', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (!lobby || lobby.host !== socket.data.color) return;
        activeGames.delete(lobbyId);
        io.to(lobbyId).emit('redirectAllToLobby');
    });

    // ──────────────────────────────────────────
    // DISCONNESSIONE DURANTE LA PARTITA
    // (rimuove il "fantasma" e fa proseguire/chiudere il round)
    // ──────────────────────────────────────────
    socket.on('disconnect', () => {
        if (!socket.data.joinedFPS) return;
        const lobbyId = socket.data.lobbyId;
        const color = socket.data.color;
        const game = activeGames.get(lobbyId);
        if (!game) return;

        // Effetto immediato: il player sparisce dal campo e, se il round è in
        // corso, conta come morto (così il round può chiudersi normalmente).
        io.to(lobbyId).emit('playerLeft', { color });
        if (game.respawnTimers && game.respawnTimers[color]) {
            clearTimeout(game.respawnTimers[color]);
            delete game.respawnTimers[color];
        }
        if (game.phase === 'playing') {
            const p = game.players[color];
            if (p && !p.dead) {
                p.dead = true;
                if (game.subphase === 'suddendeath') game.aliveCount = Math.max(0, game.aliveCount - 1);
            }
            checkRoundEnd(io, lobbyId);
        }

        // La RIMOZIONE definitiva (lobby/punteggi/endGame) è rimandata di una
        // finestra di grazia: i browser congelano le schede in background e
        // socket.io le disconnette, ma alla riattivazione il client si riconnette
        // e ri-emette joinFPS (che annulla questo timer). Senza grazia, 3 schede
        // congelate insieme facevano scattare endGame e il danno moriva per tutti.
        if (!game.rejoinTimers) game.rejoinTimers = {};
        clearTimeout(game.rejoinTimers[color]);
        console.log(`🔌 [FPS] ${color} disconnesso in partita (phase=${game.phase}) — grazia ${REJOIN_GRACE / 1000}s`);
        game.rejoinTimers[color] = setTimeout(() => {
            delete game.rejoinTimers[color];
            console.log(`🗑 [FPS] grazia scaduta per ${color} → rimozione definitiva`);
            hardRemovePlayer(io, lobbyId, color);
        }, REJOIN_GRACE);
    });
};

// ──────────────────────────────────────────
// HELPERS SERVER-SIDE
// ──────────────────────────────────────────

// Rimozione definitiva di un giocatore che NON si è riconnesso entro REJOIN_GRACE.
// (La sparizione dal campo è già avvenuta nel handler 'disconnect'.)
function hardRemovePlayer(io, lobbyId, color) {
    const game = activeGames.get(lobbyId);
    if (!game) return;
    const lobby = lobbies.get(lobbyId);

    if (lobby) {
        lobby.players = lobby.players.filter(c => c !== color);
        if (lobby.host === color && lobby.players.length > 0) lobby.host = lobby.players[0];
    }
    if (game._confirmed) game._confirmed.delete(color);
    delete game.weaponChoices[color];
    delete game.scores[color];
    delete game.points[color];

    // Nessuno rimasto → distruggi la partita
    if (!lobby || lobby.players.length === 0) {
        clearAllTimers(game);
        activeGames.delete(lobbyId);
        return;
    }

    // Un solo giocatore rimasto → termina la partita (vince chi resta)
    if (lobby.players.length < 2) {
        clearAllTimers(game);
        if (game.phase !== 'game_over') endGame(io, lobbyId);
        return;
    }

    // In selezione armi: aggiorna i conteggi e lancia il round se ora sono tutti pronti
    if (game.phase === 'weapon_select') {
        io.to(lobbyId).emit('playerConfirmed', {
            playerColor: color,
            count: game._confirmed ? game._confirmed.size : 0,
            total: lobby.players.length
        });
        if (game._confirmed && game._confirmed.size >= lobby.players.length) {
            clearTimeout(game.selectTimer);
            launchRound(io, lobbyId);
        }
    }
}

function startWeaponSelect(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (!game || !lobby) return;

    game.phase = 'weapon_select';
    game._confirmed = new Set();

    io.to(lobbyId).emit('phaseWeaponSelect', {
        duration: WEAPON_SELECT_TIME,
        currentRound: game.currentRound,
        totalRounds: game.totalRounds,
        scores: game.scores,
        points: game.points,
        weapons: WEAPONS
    });

    game.selectTimer = setTimeout(() => {
        launchRound(io, lobbyId);
    }, WEAPON_SELECT_TIME);
}

function launchRound(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (!game || !lobby) return;

    game.phase = 'playing';
    game.subphase = 'melee';

    // Reset timer di fase/respawn del round precedente
    clearAllTimers(game);
    game.respawnTimers = {};

    // Assegna spawn distanziati: con offset casuale e passo uniforme i
    // giocatori finiscono su cortili opposti (1v1 → case diverse).
    const n = SPAWN_POINTS.length;
    const offset = Math.floor(Math.random() * n);
    const stride = Math.max(1, Math.floor(n / Math.max(1, lobby.players.length)));

    // Pesca il mutatore del round, evitando di ripetere quello precedente
    const pool = MUTATORS.filter(m => m !== game.lastMutator);
    game.mutator = pool[Math.floor(Math.random() * pool.length)] || MUTATORS[0] || null;
    game.lastMutator = game.mutator;

    game.players = {};
    game.aliveCount = 0;

    lobby.players.forEach((color, i) => {
        const spawn = SPAWN_POINTS[(offset + i * stride) % n];
        const weapon = WEAPONS[game.weaponChoices[color] || 'assault'];

        game.players[color] = {
            color,
            hp: PLAYER_HP,
            bonusHp: 0,
            bonusUpdatedAt: 0,
            dead: false,
            x: spawn.x,
            y: spawn.y,
            z: spawn.z,
            angle: spawn.angle,
            weaponKey: game.weaponChoices[color] || 'assault',
            ammo: weapon.ammo,
            maxAmmo: weapon.ammo
        };
        game.aliveCount++;
    });

    console.log(`🎯 [FPS] Round ${game.currentRound}/${game.totalRounds} avviato — mutatore=${game.mutator}, players=[${Object.keys(game.players).join(', ')}]`);

    io.to(lobbyId).emit('roundStart', {
        round: game.currentRound,
        totalRounds: game.totalRounds,
        players: game.players,
        weapons: WEAPONS,
        subphase: 'melee',
        introDuration: ROUND_INTRO_TIME,
        meleeDuration: MELEE_DURATION,
        mutator: game.mutator,
        trophyHeads: game.trophyHeads,
        points: game.points
    });

    // La mischia inizia solo DOPO la fase intro (gioco congelato lato client):
    // il sudden death scatta quindi a intro + mischia, sincronizzato con i client.
    game.phaseTimer = setTimeout(() => startSuddenDeath(io, lobbyId), ROUND_INTRO_TIME + MELEE_DURATION);
}

// Rinascita istantanea durante la fase MISCHIA
function respawnPlayer(io, lobbyId, color) {
    const game = activeGames.get(lobbyId);
    if (!game) return;
    if (game.phase !== 'playing' || game.subphase !== 'melee') {
        console.log(`⚠️ [FPS] respawn di ${color} ANNULLATO (phase=${game.phase} sub=${game.subphase}) — resterebbe morto!`);
        return;
    }
    const p = game.players[color];
    if (!p) { console.log(`⚠️ [FPS] respawn di ${color} impossibile: entry assente`); return; }
    console.log(`↻ [FPS] respawn ${color}`);

    const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    p.hp = PLAYER_HP;
    p.dead = false;
    p.x = spawn.x; p.y = spawn.y; p.z = spawn.z; p.angle = spawn.angle;
    // Cambio arma in-round: al respawn si rilegge la scelta persistente, così
    // l'arma richiesta con "L" durante la mischia entra in gioco solo ora.
    const weaponKey = game.weaponChoices[color] || p.weaponKey || 'assault';
    const weapon = WEAPONS[weaponKey];
    p.weaponKey = weaponKey;
    p.ammo = weapon.ammo;
    p.maxAmmo = weapon.ammo;
    // Overheal: il bonus è protezione temporanea legata alla vita in corso →
    // azzerato al respawn.
    p.bonusHp = 0;
    if (game.respawnTimers) delete game.respawnTimers[color];

    io.to(lobbyId).emit('playerRespawn', {
        color,
        x: spawn.x, y: spawn.y, z: spawn.z, angle: spawn.angle,
        hp: PLAYER_HP,
        weaponKey,
        ammo: weapon.ammo
    });
}

// Passaggio MISCHIA → SUDDEN DEATH: respawn OFF, tutti vivi e a piena vita
// per un duello equo. Chi era in respawn rientra su uno spawn point.
function startSuddenDeath(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (!game || !lobby) return;
    if (game.phase !== 'playing' || game.subphase !== 'melee') return;

    game.subphase = 'suddendeath';
    console.log(`⚔ [FPS] SUDDEN DEATH round ${game.currentRound}`);

    // Annulla i respawn ancora in coda dalla mischia
    if (game.respawnTimers) {
        for (const t of Object.values(game.respawnTimers)) clearTimeout(t);
    }
    game.respawnTimers = {};

    const n = SPAWN_POINTS.length;
    const offset = Math.floor(Math.random() * n);
    let alive = 0;
    lobby.players.forEach((color, i) => {
        const p = game.players[color];
        if (!p) return;
        if (p.dead) {
            const spawn = SPAWN_POINTS[(offset + i) % n];
            p.x = spawn.x; p.y = spawn.y; p.z = spawn.z; p.angle = spawn.angle;
        }
        p.hp = PLAYER_HP;
        p.bonusHp = 0;   // il bonus non passa al sudden death (tutti a vita reale piena)
        p.dead = false;
        alive++;
    });
    game.aliveCount = alive;

    io.to(lobbyId).emit('suddenDeathStart', {
        players: game.players,
        aliveCount: game.aliveCount
    });

    // Caso limite: rimasto 1 solo giocatore → chiude subito il round
    checkRoundEnd(io, lobbyId);
}

// Pulisce tutti i timer attivi del game (fase + respawn)
function clearAllTimers(game) {
    if (!game) return;
    if (game.selectTimer) clearTimeout(game.selectTimer);
    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    if (game.respawnTimers) {
        for (const t of Object.values(game.respawnTimers)) clearTimeout(t);
        game.respawnTimers = {};
    }
}

function checkRoundEnd(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (!game || !lobby) return;

    // Il round può concludersi SOLO in sudden death (in mischia si respawna)
    if (game.subphase !== 'suddendeath') return;

    const alive = Object.values(game.players).filter(p => !p.dead);
    if (alive.length > 1) return;

    game.phase = 'round_end';
    clearAllTimers(game);
    const winner = alive.length === 1 ? alive[0].color : null;
    console.log(`🏁 [FPS] Round ${game.currentRound} chiuso — vincitore=${winner || 'pareggio'}`);

    if (winner) {
        game.scores[winner] = (game.scores[winner] || 0) + 1;
        game.points[winner] = (game.points[winner] || 0) + SD_WIN_BONUS;
    }

    io.to(lobbyId).emit('roundEnd', {
        winnerColor: winner,
        scores: game.scores,
        points: game.points,
        sdBonus: SD_WIN_BONUS,
        round: game.currentRound,
        totalRounds: game.totalRounds,
        nextInMs: ROUND_END_DELAY
    });

    game.currentRound++;

    if (game.currentRound > game.totalRounds) {
        // Partita finita
        setTimeout(() => endGame(io, lobbyId), ROUND_END_DELAY);
    } else {
        // Prossimo round: scelta arma a inizio di OGNI round (l'utente può cambiare loadout)
        setTimeout(() => startWeaponSelect(io, lobbyId), ROUND_END_DELAY);
    }
}

function endGame(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (!game || !lobby) return;

    game.phase = 'game_over';
    console.log(`🛑 [FPS] GAME OVER (round ${game.currentRound}/${game.totalRounds}) — da qui ogni reportHit viene rifiutato`);

    // Campione = chi ha più PUNTI (teste) totali
    let topPoints = -1;
    let champion = null;
    for (const [color, pts] of Object.entries(game.points)) {
        if (pts > topPoints) { topPoints = pts; champion = color; }
    }

    io.to(lobbyId).emit('gameOver', {
        champion,
        scores: game.scores,
        points: game.points,
        trophyHeads: game.trophyHeads,
        hostColor: lobby.host
    });
}