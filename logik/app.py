from flask import Flask, render_template, request, session, jsonify, redirect, url_for
from collections import Counter
import random
import logging

app = Flask(__name__)
app.secret_key = 'super_tajny_klic_logik_2025'

#setup log
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

#admin password
ADMIN_PASSWORD = "admin123"

#colors definition
COLORS = {
    1: "červená",
    2: "modrá",
    3: "zelená",
    4: "žlutá",
    5: "fialová",
    6: "azurová"
}
COLOR_IDS = list(COLORS.keys())

def generate_secret(num_stones, allow_repetition):
    """Generuje náhodnou tajnou kombinaci s možností opakování barev."""
    if allow_repetition:
        return [random.choice(COLOR_IDS) for _ in range(num_stones)]
    else:
        if num_stones > len(COLOR_IDS):
            raise ValueError("Nelze generovat unikátní kombinaci: příliš málo barev!")
        return random.sample(COLOR_IDS, num_stones)

def evaluate_guess(secret, guess, evaluation_mode):
    """Vyhodnotí pokus podle zvoleného způsobu hodnocení."""
    if evaluation_mode == "exact_position":
        return [1 if secret[i] == guess[i] else 0 for i in range(len(secret))]
    else:
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
    """Domovská stránka."""
    logger.info("Navštívena domovská stránka.")
    return render_template('home.html', colors=COLORS)

@app.route('/new_game', methods=['POST'])
def new_game():
    """Spustí novou hru."""
    try:
        difficulty = request.form.get('difficulty')
        num_stones = 4 if difficulty == '4' else 5
        generate_random = request.form.get('generate_random') == 'on'
        allow_repetition = request.form.get('allow_repetition') == 'yes'
        evaluation_mode = request.form.get('evaluation_mode', 'no_position')

        if generate_random:
            secret = generate_secret(num_stones, allow_repetition)
        else:
            secret_names = request.form.getlist('secret')[:num_stones]
            secret = []
            for name in secret_names:
                id = next((id for id, color in COLORS.items() if color == name), None)
                if id is None:
                    logger.error(f"Neplatná barva: {name}")
                    return jsonify({"error": "Neplatná barva! Vyberte platné barvy."}), 400
                secret.append(id)
            if not allow_repetition and len(set(secret)) != len(secret):
                logger.error("Neplatná kombinace: Opakování barev není povoleno!")
                return jsonify({"error": "Opakování barev není povoleno! Vyberte unikátní barvy."}), 400

        session['secret'] = secret
        session['guesses'] = []
        session['num_stones'] = num_stones
        session['game_over'] = False
        session['allow_repetition'] = allow_repetition
        session['evaluation_mode'] = evaluation_mode

        secret_names = [COLORS[id] for id in secret]
        logger.info(f"Nová hra: obtížnost={num_stones}, generovat_náhodně={generate_random}, opakování_barev={allow_repetition}, hodnocení={evaluation_mode}")
        logger.info(f"Tajná kombinace: ID={secret}, Barvy={secret_names}")

        return jsonify({"redirect": url_for('game')})
    except Exception as e:
        logger.error(f"Chyba při vytváření hry: {str(e)}")
        return jsonify({"error": "Chyba při vytváření hry! Zkuste znovu."}), 500

@app.route('/game')
def game():
    """Zobrazí herní plochu."""
    if 'secret' not in session:
        logger.warning("Přístup k /game bez aktivní hry.")
        return redirect(url_for('home'))
    logger.info("Navštívena herní stránka.")
    return render_template('game.html', 
                         num_stones=session['num_stones'], 
                         guesses=session.get('guesses', []), 
                         colors=COLORS,
                         game_over=session.get('game_over', False),
                         secret=session.get('secret', []),
                         evaluation_mode=session.get('evaluation_mode', 'no_position'))

@app.route('/make_guess', methods=['POST'])
def make_guess():
    """Zpracuje pokus hráče."""
    if session.get('game_over', False):
        logger.warning("Pokus odeslat pokus po ukončení hry.")
        return jsonify({"error": "Hra již skončila! Spusťte novou hru."}), 400

    try:
        guess_names = request.form.getlist('guess')
        guess = []
        for name in guess_names:
            id = next((id for id, color in COLORS.items() if color == name), None)
            if id is None:
                logger.error(f"Neplatná barva v pokusu: {name}")
                return jsonify({"error": "Neplatná barva! Vyberte platné barvy."}), 400
            guess.append(id)

        if len(guess) != session['num_stones']:
            logger.error(f"Neplatný počet kamenů v pokusu: {len(guess)} místo {session['num_stones']}")
            return jsonify({"error": f"Vyberte přesně {session['num_stones']} barev!"}), 400

        if not session.get('allow_repetition') and len(set(guess)) != len(guess):
            logger.error("Neplatný pokus: Opakování barev není povoleno!")
            return jsonify({"error": "Opakování barev není povoleno! Vyberte unikátní barvy."}), 400

        secret = session['secret']
        evaluation_mode = session.get('evaluation_mode', 'no_position')
        feedback = evaluate_guess(secret, guess, evaluation_mode)
        session['guesses'].append((guess, feedback))
        
        remaining_attempts = 10 - len(session['guesses'])
        secret_names = [COLORS[id] for id in secret]
        guess_names = [COLORS[id] for id in guess]

        logger.info(f"Pokus č. {len(session['guesses'])}:")
        logger.info(f"Tajná kombinace: ID={secret}, Barvy={secret_names}")
        logger.info(f"Pokus hráče: ID={guess}, Barvy={guess_names}")
        logger.info(f"Zpětná vazba: {feedback} (hodnocení={evaluation_mode})")
        logger.info(f"Zbývající pokusy: {remaining_attempts}")

        if evaluation_mode == "exact_position":
            is_win = all(x == 1 for x in feedback)
        else:
            is_win = feedback[0] == len(secret)  # feedback[0] je počet černých kamenů

        if is_win:
            session['game_over'] = True
            logger.info(f"Hra skončila: Výhra! Tajná kombinace uhodnuta.")
            return jsonify({
                "guesses": session['guesses'],
                "message": f"Vyhráli jste! Tajná kombinace: {', '.join(secret_names)}",
                "game_over": True,
                "remaining_attempts": remaining_attempts,
                "secret": secret,
                "evaluation_mode": evaluation_mode
            })
        elif len(session['guesses']) >= 10:
            session['game_over'] = True
            logger.info(f"Hra skončila: Prohra! Vyčerpáno 10 pokusů.")
            return jsonify({
                "guesses": session['guesses'],
                "message": f"Prohráli jste! Tajná kombinace: {', '.join(secret_names)}",
                "game_over": True,
                "remaining_attempts": remaining_attempts,
                "secret": secret,
                "evaluation_mode": evaluation_mode
            })
        
        logger.info("Hra pokračuje.")
        return jsonify({
            "guesses": session['guesses'],
            "game_over": False,
            "remaining_attempts": remaining_attempts,
            "secret": [],
            "evaluation_mode": evaluation_mode
        })
    except Exception as e:
        logger.error(f"Chyba při zpracování pokusu: {str(e)}")
        return jsonify({"error": "Chyba při zpracování pokusu! Zkuste znovu."}), 500

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
            return render_template('admin.html', secret=secret, colors=COLORS, secret_names=secret_names)
        else:
            logger.warning("Neúspěšný pokus o přístup k /admin: Špatné heslo.")
            return render_template('admin.html', error="Špatné heslo!", colors=COLORS)

    logger.info("Navštívena stránka /admin (GET).")
    return render_template('admin.html', colors=COLORS)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)