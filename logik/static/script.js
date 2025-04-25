function startNewGame(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    
    fetch('/new_game', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            document.getElementById('error-message').textContent = data.error;
        } else {
            window.location.href = data.redirect;
        }
    })
    .catch(error => {
        document.getElementById('error-message').textContent = 'Chyba při spuštění hry: ' + error.message;
        console.error('Chyba:', error);
    });
}

function submitGuess(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    
    fetch('/make_guess', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            document.getElementById('game-message').textContent = data.error;
            return;
        }
        
        const table = document.getElementById('guesses-table');
        table.innerHTML = '';
        data.guesses.forEach(([guess, black, white]) => {
            const row = document.createElement('tr');
            guess.forEach(color_id => {
                const cell = document.createElement('td');
                const stone = document.createElement('div');
                stone.className = `stone color-${COLORS[color_id].toLowerCase()}`;
                cell.appendChild(stone);
                row.appendChild(cell);
            });
            const feedbackCell = document.createElement('td');
            feedbackCell.className = 'feedback';
            for (let i = 0; i < black; i++) {
                const peg = document.createElement('div');
                peg.className = 'peg black';
                feedbackCell.appendChild(peg);
            }
            for (let i = 0; i < white; i++) {
                const peg = document.createElement('div');
                peg.className = 'peg white';
                feedbackCell.appendChild(peg);
            }
            row.appendChild(feedbackCell);
            table.appendChild(row);
        });

        document.getElementById('remaining-attempts').textContent = data.remaining_attempts;

        if (data.game_over) {
            document.getElementById('game-message').textContent = data.message;
            document.getElementById('guess-form').style.display = 'none';
            if (data.secret && data.secret.length > 0) {
                const secretDiv = document.createElement('div');
                secretDiv.id = 'secret-combination';
                secretDiv.innerHTML = '<strong>Tajná kombinace:</strong>';
                data.secret.forEach(color_id => {
                    const stone = document.createElement('div');
                    stone.className = `stone color-${COLORS[color_id].toLowerCase()}`;
                    secretDiv.appendChild(stone);
                });
                document.getElementById('game-board').insertBefore(secretDiv, document.getElementById('guesses-table'));
            }
        } else {
            document.getElementById('game-message').textContent = '';
            form.reset();
        }
    })
    .catch(error => {
        document.getElementById('game-message').textContent = 'Chyba při odeslání pokusu: ' + error.message;
        console.error('Chyba:', error);
    });
}

const COLORS = {
    1: "červená",
    2: "modrá",
    3: "zelená",
    4: "žlutá",
    5: "fialová",
    6: "azurová"
};

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('new-game-form');
    if (form) {
        form.addEventListener('submit', startNewGame);
    }

    const guessForm = document.getElementById('guess-form');
    if (guessForm) {
        guessForm.addEventListener('submit', submitGuess);
    }

    const difficultySelect = document.getElementById('difficulty');
    const generateRandomCheckbox = document.getElementById('generate_random');
    const manualInputDiv = document.getElementById('manual_input');
    const secretInputs = document.getElementsByClassName('secret_select');

    if (difficultySelect && generateRandomCheckbox && manualInputDiv) {
        function updateInputs() {
            const numStones = difficultySelect.value === '4' ? 4 : 5;
            for (let i = 0; i < secretInputs.length; i++) {
                secretInputs[i].style.display = i < numStones ? 'inline-block' : 'none';
                secretInputs[i].required = i < numStones && !generateRandomCheckbox.checked;
            }
            manualInputDiv.style.display = generateRandomCheckbox.checked ? 'none' : 'block';
        }

        difficultySelect.addEventListener('change', updateInputs);
        generateRandomCheckbox.addEventListener('change', updateInputs);
        updateInputs();
    }
});