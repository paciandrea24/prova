// frontend/tasks/garbageTask.js

const GarbageTask = {
    activeTaskId: null,
    holdInterval: null,
    progress: 100, // Partiamo dal 100% (pieno) e scendiamo a 0

    initHTML: function () {
        const taskHTML = `
        <div id="task-garbage-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel" style="width: 320px; text-align: center;">
                <div class="task-header">
                    <h2 style="margin: 0; color: #e67e22;">Svuota Spazzatura</h2>
                    <button onclick="GarbageTask.close()" class="close-btn">X</button>
                </div>
                
                <div style="height: 180px; width: 100%; background: #1a252f; position: relative; overflow: hidden; border: 3px solid #7f8c8d; border-radius: 10px; margin-bottom: 20px; display: flex; align-items: flex-end;">
                    <div id="garbage-level" style="width: 100%; height: 100%; background: #795548; transition: height 0.1s linear; display: flex; justify-content: center; align-items: center; overflow: hidden;">
                        <span style="font-size: 60px;">🗑️</span>
                    </div>
                </div>

                <button id="garbage-btn" class="key-btn" style="width: 100%; background: #d35400; border-color: #e67e22; user-select: none;"
                    onmousedown="GarbageTask.startHold()" 
                    onmouseup="GarbageTask.stopHold()" 
                    onmouseleave="GarbageTask.stopHold()">
                    TIENI PREMUTO
                </button>
                
                <div id="garbage-feedback" style="margin-top: 15px; height: 20px; font-weight: bold; color: #2ecc71;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', taskHTML);
    },

    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true; // Ferma il player
        this.progress = 100; // Reset spazzatura piena

        document.getElementById('garbage-level').style.height = '100%';
        document.getElementById('garbage-feedback').innerText = '';

        const btn = document.getElementById('garbage-btn');
        btn.disabled = false;
        btn.innerText = "TIENI PREMUTO";
        btn.style.opacity = '1';

        document.getElementById('task-garbage-overlay').classList.remove('hidden');
    },

    startHold: function () {
        const btn = document.getElementById('garbage-btn');
        if (btn.disabled) return;

        btn.style.transform = 'scale(0.95)'; // Effetto visivo pressione
        btn.innerText = "SVUOTAMENTO...";

        this.holdInterval = setInterval(() => {
            this.progress -= 3; // Velocità di svuotamento
            if (this.progress <= 0) this.progress = 0;

            document.getElementById('garbage-level').style.height = this.progress + '%';

            if (this.progress === 0) {
                this.complete();
            }
        }, 50);
    },

    stopHold: function () {
        if (this.holdInterval) {
            clearInterval(this.holdInterval);
            this.holdInterval = null;
        }
        const btn = document.getElementById('garbage-btn');
        if (!btn.disabled) {
            btn.style.transform = 'scale(1)'; // Torna normale
            btn.innerText = "TIENI PREMUTO";
        }
    },

    complete: function () {
        this.stopHold(); // Ferma l'intervallo

        const btn = document.getElementById('garbage-btn');
        btn.disabled = true;
        btn.style.transform = 'scale(1)';
        btn.style.opacity = '0.5';
        btn.innerText = "VUOTO!";

        document.getElementById('garbage-feedback').innerText = 'COMPLETATO';

        // Invia il segnale al server
        socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });

        setTimeout(() => this.close(), 1000);
    },

    close: function () {
        isTaskOpen = false;
        this.stopHold(); // Sicurezza: ferma tutto se si chiude la finestra forzatamente
        document.getElementById('task-garbage-overlay').classList.add('hidden');
    }
};

document.addEventListener("DOMContentLoaded", () => GarbageTask.initHTML());