// frontend/tasks/downloadTask.js

const DownloadTask = {
    activeTaskId: null,
    downloadInterval: null,
    progress: 0,

    initHTML: function () {
        const taskHTML = `
        <div id="task-download-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel" style="width: 400px;">
                <div class="task-header">
                    <h2 style="margin: 0; color: #3498db;">Scarica Dati</h2>
                    <button onclick="DownloadTask.close()" class="close-btn">X</button>
                </div>
                
                <div style="display: flex; justify-content: space-between; width: 100%; margin-bottom: 20px; font-size: 50px;">
                    <div>📁</div>
                    <div style="font-size: 30px; line-height: 50px; color: #bdc3c7;">➔</div>
                    <div>💾</div>
                </div>

                <div style="width: 100%; height: 30px; background: #1a252f; border-radius: 15px; overflow: hidden; margin-bottom: 20px; border: 2px solid #7f8c8d;">
                    <div id="download-progress-bar" style="width: 0%; height: 100%; background: #3498db; transition: width 0.1s linear;"></div>
                </div>

                <button id="download-btn" class="key-btn" style="width: 100%; background: #2980b9;" onclick="DownloadTask.startDownload()">AVVIA DOWNLOAD</button>
                
                <div id="download-feedback" style="margin-top: 15px; height: 20px; font-weight: bold; color: #2ecc71;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', taskHTML);
    },

    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true; // Ferma il player
        this.progress = 0;

        // Resetta l'interfaccia
        document.getElementById('download-progress-bar').style.width = '0%';
        document.getElementById('download-feedback').innerText = '';

        const btn = document.getElementById('download-btn');
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.innerText = "AVVIA DOWNLOAD";

        document.getElementById('task-download-overlay').classList.remove('hidden');
    },

    startDownload: function () {
        const btn = document.getElementById('download-btn');
        btn.disabled = true; // Impedisce doppi click
        btn.style.opacity = '0.5';
        btn.innerText = "SCARICAMENTO IN CORSO...";

        if (this.downloadInterval) clearInterval(this.downloadInterval);

        // Riempie la barra nel tempo (circa 4 secondi in totale)
        this.downloadInterval = setInterval(() => {
            this.progress += 2.5;
            document.getElementById('download-progress-bar').style.width = this.progress + '%';

            if (this.progress >= 100) {
                clearInterval(this.downloadInterval);
                this.complete();
            }
        }, 100);
    },

    complete: function () {
        document.getElementById('download-feedback').innerText = 'DOWNLOAD COMPLETATO';
        document.getElementById('download-btn').innerText = "FATTO!";

        // Invia il segnale al server
        socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });

        // Chiudi automaticamente dopo 1 secondo
        setTimeout(() => this.close(), 1000);
    },

    close: function () {
        isTaskOpen = false; // Sblocca il player
        if (this.downloadInterval) clearInterval(this.downloadInterval); // Blocca il download se chiuso a metà
        document.getElementById('task-download-overlay').classList.add('hidden');
    }
};

// Inizializza l'HTML al caricamento
document.addEventListener("DOMContentLoaded", () => DownloadTask.initHTML());