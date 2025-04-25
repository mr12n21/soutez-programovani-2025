from flask import Flask, render_template, request, jsonify, send_file
from PIL import Image
import cv2
import numpy as np
import os
import json
import logging
from io import BytesIO

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['OUTPUT_FOLDER'] = 'outputs'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['OUTPUT_FOLDER'], exist_ok=True)

# Nastavení logování
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Katalog barev z PDF
COLOR_CATALOG = {
    "maroon": (128, 0, 0),
    "red": (255, 0, 0),
    "orange": (255, 165, 0),
    "yellow": (255, 255, 0),
    "olive": (128, 128, 0),
    "purple": (128, 0, 128),
    "fuchsia": (255, 0, 255),
    "white": (255, 255, 255),
    "lime": (0, 255, 0),
    "green": (0, 128, 0),
    "navy": (0, 0, 128),
    "blue": (0, 0, 255),
    "aqua": (0, 255, 255),
    "teal": (0, 128, 128),
    "black": (0, 0, 0),
    "silver": (192, 192, 192)
}

def find_closest_color(rgb):
    """Najde nejbližší barvu z katalogu podle Euklidovské vzdálenosti."""
    min_dist = float('inf')
    closest_color = None
    for name, catalog_rgb in COLOR_CATALOG.items():
        dist = sum((a - b) ** 2 for a, b in zip(rgb, catalog_rgb)) ** 0.5
        if dist < min_dist:
            min_dist = dist
            closest_color = name
    return closest_color, COLOR_CATALOG[closest_color]

def analyze_image(image_path):
    """Analyzuje obrázek vitráže a vrátí informace o sklíčkách."""
    img = cv2.imread(image_path)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    total_area = img.shape[0] * img.shape[1]
    pieces = []
    color_groups = {}

    for idx, contour in enumerate(contours):
        area = cv2.contourArea(contour)
        if area < 100:  # Ignoruj malé kontury
            continue

        mask = np.zeros_like(img_rgb)
        cv2.drawContours(mask, [contour], -1, (255, 255, 255), -1)
        mean_color = cv2.mean(img_rgb, mask=cv2.cvtColor(mask, cv2.COLOR_RGB2GRAY))[:3]
        mean_color = tuple(int(c) for c in mean_color)

        # Najdi nejbližší barvu z katalogu
        catalog_color_name, catalog_rgb = find_closest_color(mean_color)
        percent_area = (area / total_area) * 100

        piece = {
            "id": idx,
            "area": area,
            "percent_area": round(percent_area, 2),
            "original_rgb": mean_color,
            "catalog_color": catalog_color_name,
            "catalog_rgb": catalog_rgb,
            "contour": contour.tolist()
        }
        pieces.append(piece)

        # Seskupení podle barvy
        if catalog_color_name not in color_groups:
            color_groups[catalog_color_name] = {"pieces": [], "total_area": 0, "percent_area": 0}
        color_groups[catalog_color_name]["pieces"].append(piece)
        color_groups[catalog_color_name]["total_area"] += area

    # Aktualizace procentuální plochy pro skupiny
    for color, group in color_groups.items():
        group["percent_area"] = round((group["total_area"] / total_area) * 100, 2)

    return pieces, color_groups, img_rgb

def create_replica(image_path, pieces):
    """Vytvoří repliku vitráže s dostupnými barvami."""
    img = cv2.imread(image_path)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    for piece in pieces:
        contour = np.array(piece["contour"], dtype=np.int32)
        color = piece["catalog_rgb"]
        cv2.drawContours(img_rgb, [contour], -1, color, -1)
        cv2.drawContours(img_rgb, [contour], -1, (0, 0, 0), 2)  # Černé okraje

    replica_path = os.path.join(app.config['OUTPUT_FOLDER'], 'replica.png')
    cv2.imwrite(replica_path, cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR))
    return replica_path

@app.route('/')
def index():
    """Domovská stránka."""
    logger.info("Navštívena domovská stránka.")
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    """Zpracuje nahrání obrázku a analýzu."""
    try:
        if 'image' not in request.files:
            return jsonify({"error": "Žádný obrázek nenahrán!"}), 400

        file = request.files['image']
        image_path = os.path.join(app.config['UPLOAD_FOLDER'], 'vitraz.png')
        file.save(image_path)

        pieces, color_groups, img_rgb = analyze_image(image_path)
        session_data = {
            "pieces": pieces,
            "color_groups": color_groups,
            "image_shape": img_rgb.shape[:2]
        }

        with open(os.path.join(app.config['OUTPUT_FOLDER'], 'session.json'), 'w') as f:
            json.dump(session_data, f)

        logger.info(f"Analýza dokončena: {len(pieces)} sklíček, {len(color_groups)} barev.")
        return jsonify({
            "pieces": pieces,
            "color_groups": color_groups,
            "image_path": image_path
        })
    except Exception as e:
        logger.error(f"Chyba při analýze obrázku: {str(e)}")
        return jsonify({"error": "Chyba při analýze obrázku! Zkuste znovu."}), 500

@app.route('/replace_color', methods=['POST'])
def replace_color():
    """Nahradí barvu sklíčka zvolenou uživatelem."""
    try:
        data = request.get_json()
        piece_id = data['piece_id']
        new_color = data['new_color']

        with open(os.path.join(app.config['OUTPUT_FOLDER'], 'session.json'), 'r') as f:
            session_data = json.load(f)

        pieces = session_data['pieces']
        for piece in pieces:
            if piece['id'] == piece_id:
                piece['catalog_color'] = new_color
                piece['catalog_rgb'] = COLOR_CATALOG[new_color]
                break

        # Aktualizace color_groups
        color_groups = {}
        total_area = session_data['image_shape'][0] * session_data['image_shape'][1]
        for piece in pieces:
            color = piece['catalog_color']
            if color not in color_groups:
                color_groups[color] = {"pieces": [], "total_area": 0, "percent_area": 0}
            color_groups[color]["pieces"].append(piece)
            color_groups[color]["total_area"] += piece['area']
        for color, group in color_groups.items():
            group["percent_area"] = round((group["total_area"] / total_area) * 100, 2)

        session_data['pieces'] = pieces
        session_data['color_groups'] = color_groups

        with open(os.path.join(app.config['OUTPUT_FOLDER'], 'session.json'), 'w') as f:
            json.dump(session_data, f)

        logger.info(f"Barva sklíčka {piece_id} nahrazena: {new_color}")
        return jsonify({"pieces": pieces, "color_groups": color_groups})
    except Exception as e:
        logger.error(f"Chyba při náhradě barvy: {str(e)}")
        return jsonify({"error": "Chyba při náhradě barvy! Zkuste znovu."}), 500

@app.route('/save_plan', methods=['POST'])
def save_plan():
    """Uloží řezací plán."""
    try:
        data = request.get_json()
        plan = data['plan']
        plan_path = os.path.join(app.config['OUTPUT_FOLDER'], 'cutting_plan.json')
        with open(plan_path, 'w') as f:
            json.dump(plan, f)
        logger.info("Řezací plán uložen.")
        return jsonify({"message": "Řezací plán uložen!"})
    except Exception as e:
        logger.error(f"Chyba při ukládání plánu: {str(e)}")
        return jsonify({"error": "Chyba při ukládání plánu! Zkuste znovu."}), 500

@app.route('/generate_replica', methods=['POST'])
def generate_replica():
    """Vygeneruje repliku vitráže."""
    try:
        with open(os.path.join(app.config['OUTPUT_FOLDER'], 'session.json'), 'r') as f:
            session_data = json.load(f)

        image_path = os.path.join(app.config['UPLOAD_FOLDER'], 'vitraz.png')
        replica_path = create_replica(image_path, session_data['pieces'])

        logger.info("Replika vitráže vygenerována.")
        return jsonify({"replica_path": replica_path})
    except Exception as e:
        logger.error(f"Chyba při generování repliky: {str(e)}")
        return jsonify({"error": "Chyba při generování repliky! Zkuste znovu."}), 500

@app.route('/download/<filename>')
def download(filename):
    """Umožní stažení souboru."""
    file_path = os.path.join(app.config['OUTPUT_FOLDER'], filename)
    return send_file(file_path, as_attachment=True)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)