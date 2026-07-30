// frontend/register.js
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

    const ERROR_MESSAGES = {
        'auth/email-already-in-use': 'An account already exists with this email.',
        'auth/invalid-email': 'That email address looks invalid.',
        'auth/weak-password': 'Password should be at least 6 characters.'
    };
    function friendlyError(err) {
        console.error('[auth]', err.code, err.message);
        return ERROR_MESSAGES[err.code] || 'Something went wrong. Please try again.';
    }

    document.addEventListener('DOMContentLoaded', () => {
        ReturnTo.wireAuthPage();

        if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
            showToast('Firebase is not configured yet.', 'error');
            return;
        }

        document.getElementById('registerForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (password !== confirmPassword) {
                showToast('Passwords do not match.', 'error');
                return;
            }

            firebaseAuth.createUserWithEmailAndPassword(email, password)
                .then(() => { ReturnTo.finishAuth(); })
                .catch((err) => showToast(friendlyError(err), 'error'));
        });
    });
})();
