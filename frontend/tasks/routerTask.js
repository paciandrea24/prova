// frontend/tasks/routerTask.js

const RouterTask = {
    activeTaskId: null,
    step: 0, // 0 = acceso (da spegnere), 1 = riavvio in corso, 2 = spento (da riaccendere)
    timeoutId: null,

    initHTML: function () {
        const taskHTML = `
        <div id="task-router-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel" style="width: 350px; text-align: center;">
                <div class="task-header">
                    <h2 style="margin: 0; color: #9b59b6;">Riavvia Router</h2>
                    <button onclick="RouterTask.close()" class="close-btn">X</button>
                </div>
                
                <div style="padding: 30px; background: #1a252f; border-radius: 10px; margin-bottom: 20px; border: 2px solid #7f8c8d;">
                    <div id="router-lights" style="display: flex; justify-content: center; gap: 15px; margin-bottom: 20px;">
                        <div class="light" style="width: 20px; height: 20px; border-radius: 50%; background: #2ecc71; box-shadow: 0 0 10px #2ecc71;"></div>
                        <div class="light" style="width: 20px; height: 20px; border-radius: 50%; background: #2ecc71; box-shadow: 0 0 10px #2ecc71;"></div>
                        <div class="light" style="width: 20px; height: 20px; border-radius: 50%; background: #2ecc71; box-shadow: 0 0 10px #2ecc71;"></div>
                    </div>
                    <button id="router-btn" class="key-btn" style="width: 100%; background: #e74c3c; border-color: #c0392b;" onclick="RouterTask.handleClick()">SPEGNI</button>
                </div>
                
                <div id="router-feedback" style="height: 20px; font-weight: bold; color: #f1c40f;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', taskHTML);
    },

    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true;
        this.step = 0;

        this.updateUI(true, "SPEGNI", "#e74c3c", "");
        document.getElementById('task-router-overlay').classList.remove('hidden');
    },

    handleClick: function () {
        const btn = document.getElementById('router-btn');

        if (this.step === 0) {
            // Step 1: Spegni e attendi
            this.step = 1;
            this.updateUI(false, "RIAVVIO IN CORSO...", "#7f8c8d", "Attendi...");
            btn.disabled = true;

            this.timeoutId = setTimeout(() => {
                if (this.step === 1) {
                    this.step = 2;
                    this.updateUI(false, "ACCENDI", "#2ecc71", "Pronto per l'accensione");
                    btn.disabled = false;
                }
            }, 3000); // 3 secondi di attesa

        } else if (this.step === 2) {
            // Step 2: Riaccendi e completa
            this.updateUI(true, "CONNESSO", "#3498db", "RIAVVIO COMPLETATO");
            btn.disabled = true;

            socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });
            setTimeout(() => this.close(), 1000);
        }
    },

    updateUI: function (lightsOn, btnText, btnColor, feedbackText) {
        document.getElementById('router-btn').innerText = btnText;
        document.getElementById('router-btn').style.background = btnColor;
        document.getElementById('router-feedback').innerText = feedbackText;

        const lights = document.querySelectorAll('#router-lights .light');
        lights.forEach(l => {
            if (lightsOn) {
                l.style.background = '#2ecc71';
                l.style.boxShadow = '0 0 10px #2ecc71';
            } else {
                l.style.background = '#333';
                l.style.boxShadow = 'none';
            }
        });
    },

    close: function () {
        isTaskOpen = false;
        if (this.timeoutId) clearTimeout(this.timeoutId);
        document.getElementById('task-router-overlay').classList.add('hidden');
    }
};

document.addEventListener("DOMContentLoaded", () => RouterTask.initHTML());