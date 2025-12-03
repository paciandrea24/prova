// game/triviaGame.js
const ITALIAN_QUESTIONS = require('./italianQuestions');

// Funzione di utilità per mescolare un array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Funzione simulata che "scarica" le domande
async function fetchTriviaQuestions(amount = 5) {
    let allQuestions = [...ITALIAN_QUESTIONS];
    shuffleArray(allQuestions);
    const selectedQuestions = allQuestions.slice(0, amount);

    return selectedQuestions.map(item => {
        let options = [...item.incorrect_answers, item.correct_answer];
        options = shuffleArray(options);
        const correctIndex = options.indexOf(item.correct_answer);

        return {
            // [FIX IMPORTANTE] Usiamo ...item per mantenere proprietà come 'type' e 'imageSearch'
            // Senza questo, il socket non saprebbe cosa cercare su Wikipedia!
            ...item,

            question: item.question,
            options: options,
            correctIndex: correctIndex,
            imageUrl: item.imageUrl || null
        };
    });
}

// Inizializza il gioco
function initializeTriviaGame(gameId, settings, questions) {
    return {
        type: 'trivia',
        isActive: true,
        currentRound: 0,
        totalRounds: questions.length,
        roundDuration: 15,
        timer: 0,

        questionsList: questions, // [NOTA] Qui la proprietà si chiama 'questionsList'

        currentQuestion: null,
        correctAnswerIndex: -1,
        playerAnswers: {},
        answeredCount: 0,
        scores: {},
        currentImageUrl: null // Per gestire i reload
    };
}

// Calcolo Punti
function calculateTriviaPoints(timeLeft, totalTime) {
    if (!timeLeft || !totalTime || totalTime === 0) return 10;
    const percentage = timeLeft / totalTime;
    const points = Math.floor(100 * percentage);
    return Math.max(points, 10);
}

// Prende la prossima domanda
function getNextQuestion(game) {
    const roundIndex = game.currentRound;

    // [FIX DELL'ERRORE] Usiamo game.questionsList, non game.questions
    if (roundIndex >= game.questionsList.length) return null;

    const q = game.questionsList[roundIndex];

    return {
        text: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        // Passiamo l'URL (che potrebbe essere stato trovato da Wikipedia nel socket)
        imageUrl: q.imageUrl || null,
        imageSearch: q.imageSearch
    };
}

module.exports = {
    initializeTriviaGame,
    calculateTriviaPoints,
    getNextQuestion,
    fetchTriviaQuestions
};