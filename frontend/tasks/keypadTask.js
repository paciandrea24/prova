// frontend/tasks/keypadTask.js

const KeypadTask = {
    currentCode: "",
    enteredCode: "",
    activeTaskId: null,

    // 1. Inietta l'HTML della task dinamicamente quando il file viene caricato
    initHTML: function () {
        const taskHTML = `
        <div id="task-keypad-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel">
                <div class="task-header">
                    <h2 style="margin: 0; color: #f1c40f;">Inserisci il Codice</h2>
                    <button onclick="KeypadTask.close()" class="close-btn">X</button>
                </div>
                <div class="keypad-display">
                    <div id="expected-code" class="code-box">8249</div>
                    <div id="entered-code" class="input-box">----</div>
                </div>
                <div class="keypad-grid">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="key-btn" onclick="KeypadTask.pressKey(${n})">${n}</button>`).join('')}
                    <button class="key-btn clear-btn" onclick="KeypadTask.clear()">C</button>
                    <button class="key-btn" onclick="KeypadTask.pressKey(0)">0</button>
                    <button class="key-btn enter-btn" onclick="KeypadTask.submit()">OK</button>
                </div>
                <div id="task-feedback" style="margin-top: 15px; height: 20px; font-weight: bold;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', taskHTML);
    },

    // 2. Apri la task
    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true; // Ferma il movimento del player (variabile globale in deduction.js)

        this.currentCode = Math.floor(1000 + Math.random() * 9000).toString();
        this.enteredCode = "";

        document.getElementById('expected-code').innerText = this.currentCode;
        this.updateDisplay();
        document.getElementById('task-feedback').innerText = "";

        document.getElementById('task-keypad-overlay').classList.remove('hidden');
    },

    // 3. Logica dei tasti
    pressKey: function (num) {
        if (this.enteredCode.length < 4) {
            this.enteredCode += num;
            this.updateDisplay();
        }
    },

    clear: function () {
        this.enteredCode = "";
        this.updateDisplay();
        document.getElementById('entered-code').style.color = "#2ecc71";
        document.getElementById('task-feedback').innerText = "";
    },

    updateDisplay: function () {
        document.getElementById('entered-code').innerText = this.enteredCode.padEnd(4, '-');
    },

    submit: function () {
        const feedback = document.getElementById('task-feedback');
        const display = document.getElementById('entered-code');

        if (this.enteredCode === this.currentCode) {
            display.style.color = "#27ae60";
            feedback.style.color = "#27ae60";
            feedback.innerText = "ACCESSO CONSENTITO";

            // Usa le variabili globali di deduction.js (socket, lobbyId, myColor)
            socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });

            setTimeout(() => this.close(), 800);
        } else {
            display.style.color = "#e74c3c";
            feedback.style.color = "#e74c3c";
            feedback.innerText = "CODICE ERRATO";
            setTimeout(() => this.clear(), 1000);
        }
    },

    close: function () {
        isTaskOpen = false; // Sblocca il player
        document.getElementById('task-keypad-overlay').classList.add('hidden');
    }
};

// Inizializza l'HTML appena il documento è pronto
document.addEventListener("DOMContentLoaded", () => KeypadTask.initHTML());