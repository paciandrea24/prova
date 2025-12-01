// game/triviaGame.js

// Un set di domande di prova (in futuro le prenderemo da un DB o API)
const MOCK_QUESTIONS = [
    {
        question: "Qual è la capitale della Francia?",
        options: ["Londra", "Berlino", "Parigi", "Madrid"],
        correctIndex: 2 // Parigi
    },
    {
        question: "Quanto fa 5 * 5?",
        options: ["10", "25", "55", "50"],
        correctIndex: 1 // 25
    },
    {
        question: "Di che colore è il cavallo bianco di Napoleone?",
        options: ["Nero", "Bianco", "Marrone", "Grigio"],
        correctIndex: 1 // Bianco
    }
];

// Funzione per inizializzare il gioco Trivia
function initializeTriviaGame(gameId, settings) {
    return {
        type: 'trivia',      // Identificativo del gioco
        isActive: true,
        currentRound: 0,
        totalRounds: settings.rounds || 5, // Default 5 round
        roundDuration: 15,   // Secondi per rispondere
        timer: 0,

        // Stato della domanda corrente
        currentQuestion: null,
        correctAnswerIndex: -1,

        // Gestione risposte
        playerAnswers: {},   // Chi ha risposto cosa
        answeredCount: 0,    // Quanti hanno risposto

        // Punteggi
        scores: {},          // Mappa punteggi { 'Blue': 0, 'Red': 0 }
    };
}

// Logica per calcolare i punti basata sulla velocità
// Più tempo rimane sul timer, più punti prendi (max 100, min 10)
function calculateTriviaPoints(timeLeft, totalTime) {
    if (!timeLeft || !totalTime || totalTime === 0) return 10; // Sicurezza

    const percentage = timeLeft / totalTime;
    const points = Math.floor(100 * percentage);

    // Assicuriamoci che torni un numero valido e almeno 10 punti
    return Math.max(points, 10);
}

// Prende una domanda a caso (o sequenziale)
function getNextQuestion(roundIndex) {
    // Per ora le prendiamo in ordine ciclico
    const q = MOCK_QUESTIONS[roundIndex % MOCK_QUESTIONS.length];
    return {
        text: q.question,
        options: q.options,
        correctIndex: q.correctIndex
    };
}

module.exports = {
    initializeTriviaGame,
    calculateTriviaPoints,
    getNextQuestion
};