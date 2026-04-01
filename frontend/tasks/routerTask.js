const RouterTask = {
    activeTaskId: null,
    step: 0, // 0 = Acceso, 1 = Spegnimento, 2 = Spento, 3 = Riaccensione
    timer: null,

    initHTML: function () {
        const html = `
        <div id="task-router-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel" style="width: 300px; text-align: center;">
                <div class="task-header">
                    <h2 style="margin: 0; color: #2ecc71;">Riavvia Router</h2>
                    <button onclick="RouterTask.close()" class="close-btn">X</button>
                </div>
                <div id="router-screen" style="background: #111; color: #2ecc71; padding: 20px; font-family: monospace; border-radius: 5px; margin-bottom: 20px; border: 2px solid #333; height: 60px; display: flex; align-items: center; justify-content: center; font-size: 18px;">
                    STATO: ONLINE
                </div>
                <button id="router-btn" class="key-btn" style="width: 100%; background: #e74c3c; border-color: #c0392b;" onclick="RouterTask.interact()">SPEGNI</button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true;
        this.step = 0;
        this.updateUI("STATO: ONLINE", "SPEGNI", "#e74c3c");
        document.getElementById('task-router-overlay').classList.remove('hidden');
    },

    interact: function () {
        if (this.step === 0) { // Spegni
            this.step = 1;
            this.updateUI("SPEGNIMENTO...", "ATTENDERE...", "#7f8c8d", true);
            this.timer = setTimeout(() => {
                this.step = 2;
                this.updateUI("STATO: OFFLINE", "ACCENDI", "#2ecc71");
            }, 1500);
        } else if (this.step === 2) { // Accendi
            this.step = 3;
            this.updateUI("RIACCENSIONE...", "ATTENDERE...", "#7f8c8d", true);
            this.timer = setTimeout(() => {
                this.updateUI("CONNESSIONE STABILITA", "FATTO!", "#3498db", true);
                socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });
                setTimeout(() => this.close(), 1000);
            }, 2000);
        }
    },

    updateUI: function (screenText, btnText, btnColor, disabled = false) {
        const screen = document.getElementById('router-screen');
        const btn = document.getElementById('router-btn');
        screen.innerText = screenText;
        btn.innerText = btnText;
        btn.style.background = btnColor;
        btn.disabled = disabled;
    },

    close: function () {
        isTaskOpen = false;
        if (this.timer) clearTimeout(this.timer);
        document.getElementById('task-router-overlay').classList.add('hidden');
    }
};
document.addEventListener("DOMContentLoaded", () => RouterTask.initHTML());