// frontend/login.js
(function () {
    function showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        let icon = '';
        if (type === 'error') icon = '⚠️';
        if (type === 'success') icon = '✅';
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // Messaggi Firebase Auth tradotti in inglese (hub in inglese, vedi
    // CLAUDE.md — solo i giochi restano in italiano).
    const ERROR_MESSAGES = {
        'auth/invalid-email': 'That email address looks invalid.',
        'auth/user-disabled': 'This account has been disabled.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Wrong password.',
        'auth/invalid-credential': 'Wrong email or password.',
        'auth/too-many-requests': 'Too many attempts. Try again later.',
        'auth/popup-closed-by-user': 'Google sign-in was cancelled.'
    };
    function friendlyError(err) {
        return ERROR_MESSAGES[err.code] || 'Something went wrong. Please try again.';
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
            showToast('Firebase is not configured yet.', 'error');
            return;
        }

        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            firebaseAuth.signInWithEmailAndPassword(email, password)
                .then(() => { window.location.href = 'index.html'; })
                .catch((err) => showToast(friendlyError(err), 'error'));
        });

        document.getElementById('google-btn').addEventListener('click', () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            firebaseAuth.signInWithPopup(provider)
                .then(() => { window.location.href = 'index.html'; })
                .catch((err) => showToast(friendlyError(err), 'error'));
        });
    });
})();
