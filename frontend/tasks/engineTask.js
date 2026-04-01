// frontend/tasks/engineTask.js

const EngineTask = {
    activeTaskId: null,

    initHTML: function () {
        const taskHTML = `
        <div id="task-engine-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel" style="width: 400px; text-align: center;">
                <div class="task-header">
                    <h2 style="margin: 0; color: #e74c3c;">Allinea Motore</h2>
                    <button onclick="EngineTask.close()" class="close-btn">X</button>
                </div>
                
                <div style="padding: 20px; background: #1a252f; border-radius: 10px; margin-bottom: 20px; border: 2px solid #7f8c8d; position: relative;">
                    <div style="position: absolute; left: 50%; top: 10px; bottom: 10px; width: 4px; background: rgba(46, 204, 113, 0.5); transform: translateX(-50%); pointer-events: none;"></div>
                    
                    <p style="color: white; margin-bottom: 20px;">Trascina l'indicatore al centro</p>
                    
                    <input type="range" id="engine-slider" min="0" max="100" value="10" 
                        style="width: 100%; cursor: pointer; accent-color: #e74c3c; height: 30px;"
                        oninput="EngineTask.checkAlignment(this.value)">
                </div>
                
                <div id="engine-feedback" style="height: 20px; font-weight: bold; color: #2ecc71;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', taskHTML);
    },

    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true;

        // Imposta lo slider a un valore casuale che NON sia 50
        let startVal = Math.random() > 0.5 ? Math.floor(Math.random() * 30) : Math.floor(Math.random() * 30) + 70;
        const slider = document.getElementById('engine-slider');
        slider.value = startVal;
        slider.disabled = false;

        document.getElementById('engine-feedback').innerText = '';
        document.getElementById('task-engine-overlay').classList.remove('hidden');
    },

    checkAlignment: function (value) {
        // Se il valore è esattamente 50, la task è completata
        if (parseInt(value) === 50) {
            const slider = document.getElementById('engine-slider');
            slider.disabled = true; // Blocca lo slider

            document.getElementById('engine-feedback').innerText = 'MOTORE ALLINEATO!';

            socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });
            setTimeout(() => this.close(), 1000);
        }
    },

    close: function () {
        isTaskOpen = false;
        document.getElementById('task-engine-overlay').classList.add('hidden');
    }
};

document.addEventListener("DOMContentLoaded", () => EngineTask.initHTML());