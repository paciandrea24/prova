const WeaponsTask = {
    activeTaskId: null,
    targetsLeft: 5,

    initHTML: function () {
        const html = `
        <div id="task-weapons-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel" style="width: 400px; height: 350px; display: flex; flex-direction: column;">
                <div class="task-header" style="margin-bottom: 10px;">
                    <h2 style="margin: 0; color: #e74c3c;">Carica Armi</h2>
                    <button onclick="WeaponsTask.close()" class="close-btn">X</button>
                </div>
                <p style="color: white; margin: 0 0 10px 0; text-align: center;">Distruggi <span id="weapons-counter">5</span> bersagli</p>
                
                <div id="weapons-screen" style="width: 100%; flex: 1; background: #000; position: relative; border: 3px solid #7f8c8d; border-radius: 5px; overflow: hidden; cursor: crosshair;">
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true;
        this.targetsLeft = 5;
        document.getElementById('weapons-counter').innerText = this.targetsLeft;

        const screen = document.getElementById('weapons-screen');
        screen.innerHTML = '';

        for (let i = 0; i < 5; i++) {
            const target = document.createElement('div');
            target.style.width = '40px'; target.style.height = '40px';
            target.style.background = '#f39c12'; target.style.borderRadius = '50%';
            target.style.position = 'absolute';
            target.style.left = Math.random() * 300 + 'px';
            target.style.top = Math.random() * 200 + 'px';
            target.onmousedown = () => this.hitTarget(target);
            screen.appendChild(target);
        }
        document.getElementById('task-weapons-overlay').classList.remove('hidden');
    },

    hitTarget: function (el) {
        el.style.background = '#e74c3c'; // Esplosione
        setTimeout(() => el.remove(), 100);
        this.targetsLeft--;
        document.getElementById('weapons-counter').innerText = this.targetsLeft;

        if (this.targetsLeft === 0) {
            socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });
            setTimeout(() => this.close(), 600);
        }
    },

    close: function () {
        isTaskOpen = false;
        document.getElementById('task-weapons-overlay').classList.add('hidden');
    }
};
document.addEventListener("DOMContentLoaded", () => WeaponsTask.initHTML());