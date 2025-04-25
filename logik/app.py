from flask import Flask, render_template, request, session, jsonify, redirect, url_for
from collections import Counter
import random
import logging

app = Flask(__name__)
app.secret_key = 'super_tajny_klic_logik_2025'

# Nastavení logování
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Admin heslo (pro jednoduchost pevně nastavené)
ADMIN_PASSWORD = "admin123"

# Definice barev: ID (1-6) mapováno na názvy barev
COLORS = {
    1: "červená",
    2: "modrá",
    3: "zelená",
    4: "žlutá",
    5: "fialová",
    6: "azurová"
}
COLOR_IDS = list(COLORS.keys())  # [1, 2, 3, 4, 5, 6]

def generate_secret(num_stones):
    """Generuje náhodnou tajnou kombinaci pomocí ID barev."""
    return [random.choice(COLOR_IDS) for _ in range(num_stones)]

def evaluate_guess(secret, guess):
    """Vyhodnotí pokus a vrátí počet černých a bílých kamenů."""
    n = len(secret)
    black = sum(1 for i in range(n) if secret[i] == guess[i])
    S_prime = [secret[i] for i in range(n) if secret[i] != guess[i]]
    G_prime = [guess[i] for i in range(n) if secret[i] != guess[i]]
    C_S = Counter(S_prime)
    C_G = Counter(G_prime)
    white = sum(min(C_S[c], C_G[c]) for c in set(C_S) & set(C_G))
    return black, white

@app.route('/')
def home():
    """Domovská stránka s formulářem pro nastavení hry."""
    return render_template('home.html', colors=COLORS)

@app.route('/new_game', methods=['POST'])
def new_game():
    """Spustí novou hru podle zadaných parametrů."""
    difficulty = request.form['difficulty']
    num_stones = 4 if difficulty == '4' else 5
    generate_random = request.form.get('generate_random', 'on') == 'on'
    
    if generate_random:
        secret = generate_secret(num_stones)
    else:
        try:
            secret_names = request.form.getlist('secret')[:num_stones]
            secret = [next(id for id, name in COLORS.items() if name == color_name) 
                     for color_name in secret_names]
            if not all(id in COLOR_IDS for id in secret):
                return jsonify({"error": "Neplatná kombinace! Vyberte platné barvy."}), 400
        except (ValueError, StopIteration):
            return jsonify({"error": "Neplatný vstup! Vyberte platné barvy."}), 400

    session['secret'] = secret
    session['guesses'] = []
    session['num_stones'] = num_stones
    session['game_over'] = False

    # Logování nové hry
    secret_names = [COLORS[id] for id in secret]
    logger.info(f"Nová hra: obtížnost={num_stones} kamenů, generovat_náhodně={generate_random}")
    logger.info(f"Tajná kombinace: ID={secret}, Barvy={secret_names}")

    return jsonify({"redirect": url_for('game')})

@app.route('/game')
def game():
    """Zobrazí herní plochu."""
    if 'secret' not in session:
        return redirect(url_for('home'))
    return render_template('game.html', 
                         num_stones=session['num_stones'], 
                         guesses=session.get('guesses', []), 
                         colors=COLORS,
                         game_over=session.get('game_over', False),
                         secret=session.get('secret', []))

@app.route('/make_guess', methods=['POST'])
def make_guess():
    """Zpracuje pokus hráče přes AJAX."""
    if session.get('game_over', False):
        return jsonify({"error": "Hra již skončila! Spusťte novou hru."}), 400

    try:
        guess_names = request.form.getlist('guess')
        guess = [next(id for id, name in COLORS.items() if name == color_name) 
                for color_name in guess_names]
        if len(guess) != session['num_stones'] or not all(id in COLOR_IDS for id in guess):
            return jsonify({"error": "Neplatný pokus! Vyberte platné barvy."}), 400
    except (ValueError, StopIteration):
        return jsonify({"error": "Neplatný vstup! Vyberte platné barvy."}), 400

    secret = session['secret']
    black, white = evaluate_guess(secret, guess)
    session['guesses'].append((guess, black, white))
    
    remaining_attempts = 10 - len(session['guesses'])
    secret_names = [COLORS[id] for id in secret]
    guess_names = [COLORS[id] for id in guess]

    # Logování pokusu
    logger.info(f"Pokus č. {len(session['guesses'])}:")
    logger.info(f"Tajná kombinace: ID={secret}, Barvy={secret_names}")
    logger.info(f"Pokus hráče: ID={guess}, Barvy={guess_names}")
    logger.info(f"Výsledek: {black} černých, {white} bílých kamenů")
    logger.info(f"Zbývající pokusy: {remaining_attempts}")

    if black == len(secret):
        session['game_over'] = True
        logger.info(f"Hra skončila: Výhra! Tajná kombinace uhodnuta.")
        return jsonify({
            "guesses": session['guesses'],
            "message": f"Vyhráli jste! Tajná kombinace: {', '.join(secret_names)}",
            "game_over": True,
            "remaining_attempts": remaining_attempts,
            "secret": secret
        })
    elif len(session['guesses']) >= 10:
        session['game_over'] = True
        logger.info(f"Hra skončila: Prohra! Vyčerpáno 10 pokusů.")
        return jsonify({
            "guesses": session['guesses'],
            "message": f"Prohráli jste! Tajná kombinace: {', '.join(secret_names)}",
            "game_over": True,
            "remaining_attempts": remaining_attempts,
            "secret": secret
        })
    
    logger.info("Hra pokračuje.")
    return jsonify({
        "guesses": session['guesses'],
        "game_over": False,
        "remaining_attempts": remaining_attempts,
        "secret": []
    })

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    """Zobrazí tajnou kombinaci po ověření hesla."""
    if 'secret' not in session:
        logger.warning("Přístup k /admin: Žádná aktivní hra.")
        return render_template('admin.html', error="Žádná aktivní hra!", colors=COLORS)

    if request.method == 'POST':
        password = request.form.get('password')
        if password == ADMIN_PASSWORD:
            secret = session['secret']
            secret_names = [COLORS[id] for id in secret]
            logger.info(f"Úspěšný přístup k /admin: Tajná kombinace: ID={secret}, Barvy={secret_names}")
            return render_template('admin.html', secret=secret, colors=COLORS)
        else:
            logger.warning("Neúspěšný pokus o přístup k /admin: Špatné heslo.")
            return render_template('admin.html', error="Špatné heslo!", colors=COLORS)

    return render_template('admin.html', colors=COLORS)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)