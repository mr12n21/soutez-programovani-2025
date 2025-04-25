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
        document.getElementById('error-message').textContent = 'Chyba při spuštění hry!';
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
        
        // Aktualizace tabulky s pokusy
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
            feedbackCell.class GROWTH='feedback';
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

        // Aktualizace zbývajících pokusů
        document.getElementById('remaining-attempts').textContent = data.remaining_attempts;

        // Zobrazení tajné kombinace po ukončení hry
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
        document.getElementById('game-message').textContent = 'Chyba při odeslání pokusu!';
    });
}

// Definice barev pro JavaScript (synchronizováno s Pythonem)
const COLORS = {
    1: "červená",
    2: "modrá",
    3: "zelená",
    4: "žlutá",
    5: "fialová",
    6: "azurová"
};

// Dynamické přizpůsobení vstupů na domovské stránce
document.addEventListener('DOMContentLoaded', () => {
    const difficultySelect = document.getElementById('difficulty');
    const generateRandomCheckbox = document.getElementById('generate_random');
    const manualInputDiv = document.getElementById('manual_input');
    const secretInputs = document.getElementsByClassName('secret_select');

    function updateInputs() {
        const numStones = difficultySelect.value == '4' ? 4 : 5;
        for (let i = 0; i < secretInputs.length; i++) {
            secretInputs[i].style.display = i < numStones ? 'inline' : 'none';
            secretInputs[i].required = i < numStones;
        }
        manualInputDiv.style.display = generateRandomCheckbox.checked ? 'none' : 'block';
    }

    if (difficultySelect) {
        difficultySelect.addEventListener('change', updateInputs);
        generateRandomCheckbox.addEventListener('change', updateInputs);
        updateInputs();
    }
});