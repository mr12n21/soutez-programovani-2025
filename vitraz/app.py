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

def convert_to_json_serializable(obj):
    """Převede NumPy typy na standardní Python typy pro JSON serializaci."""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, (list, tuple)):
        return [convert_to_json_serializable(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: convert_to_json_serializable(value) for key, value in obj.items()}
    return obj

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
    # Načtení obrázku
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("Nepodařilo se načíst obrázek!")
    
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Krok 1: Korekce kontrastu pro lepší detekci černých čar
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # Krok 2: Převod na HSV a detekce černých oblastí
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower_black = np.array([0, 0, 0])
    upper_black = np.array([180, 255, 20])  # Snížený práh pro černou barvu
    black_mask = cv2.inRange(hsv, lower_black, upper_black)

    # Krok 3: Redukce šumu a detekce hran
    blurred = cv2.bilateralFilter(gray, 9, 75, 75)
    edges = cv2.Canny(blurred, 30, 100)  # Nižší prahy pro citlivější detekci hran

    # Kombinace Canny hran s maskou černých oblastí
    edges = cv2.bitwise_and(edges, edges, mask=black_mask)

    # Krok 4: Morfologické operace pro spojení černých čar
    kernel = np.ones((5, 5), np.uint8)  # Menší kernel pro přesnější detekci
    dilated = cv2.dilate(edges, kernel, iterations=3)
    eroded = cv2.erode(dilated, kernel, iterations=1)

    # Krok 5: Najdeme vnější hranici vitráže
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("Nepodařilo se najít vnější hranici vitráže!")

    outer_contour = max(contours, key=cv2.contourArea)
    mask_outer = np.zeros_like(gray)
    cv2.drawContours(mask_outer, [outer_contour], -1, 255, -1)

    # Krok 6: Vytvoření markerů pro watershed
    dist_transform = cv2.distanceTransform(eroded, cv2.DIST_L2, 5)
    _, sure_fg = cv2.threshold(dist_transform, 0.5 * dist_transform.max(), 255, 0)  # Nižší práh pro více markerů
    sure_fg = np.uint8(sure_fg)

    sure_bg = cv2.dilate(eroded, kernel, iterations=3)
    sure_bg = cv2.erode(sure_bg, kernel, iterations=2)
    unknown = cv2.subtract(sure_bg, sure_fg)

    # Označení markerů
    _, markers = cv2.connectedComponents(sure_fg)
    markers = markers + 1  # Pozadí bude 1
    markers[unknown == 255] = 0  # Neznámé oblasti označíme jako 0

    # Krok 7: Aplikace watershed algoritmu
    cv2.watershed(img_rgb, markers)
    boundaries = (markers == -1).astype(np.uint8) * 255

    # Krok 8: Identifikace jednotlivých sklíček
    pieces = []
    color_groups = {}
    total_area = img.shape[0] * img.shape[1]

    unique_labels = np.unique(markers)
    for label in unique_labels:
        if label <= 1:  # Ignorujeme pozadí (1) a hranice (-1)
            continue

        # Vytvoříme masku pro dané sklíčko
        mask = (markers == label).astype(np.uint8) * 255
        area = cv2.countNonZero(mask)
        if area < 100:  # Snížený práh pro zachycení menších sklíček
            continue

        # Najdeme průměrnou barvu sklíčka
        masked_rgb = cv2.bitwise_and(img_rgb, img_rgb, mask=mask)
        mean_color = cv2.mean(masked_rgb, mask=mask)[:3]
        mean_color = tuple(int(c) for c in mean_color)

        # Ignorujeme černé ohraničení (RGB blízké černé)
        if all(c < 15 for c in mean_color):
            continue

        # Najdeme konturu sklíčka
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = contours[0]

        # Najdeme nejbližší barvu z katalogu
        catalog_color_name, catalog_rgb = find_closest_color(mean_color)
        percent_area = (area / total_area) * 100

        piece = {
            "id": int(label),
            "area": int(area),
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

    if not pieces:
        raise ValueError("Žádná sklíčka nenalezena!")

    # Převod na JSON-serializovatelné typy
    pieces = convert_to_json_serializable(pieces)
    color_groups = convert_to_json_serializable(color_groups)

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

        # Převod na JSON-serializovatelné typy
        session_data = convert_to_json_serializable(session_data)

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

        #prevod na json serializovaneho typu
        session_data = convert_to_json_serializable(session_data)

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
        logger.info(f"Přijatý řezací plán: {plan}") #log pro debug
        plan = convert_to_json_serializable(plan)
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

@app.route('/uploads/<filename>')
def serve_uploaded_file(filename):
    """Umožní přístup k souborům v uploads složce."""
    return send_file(os.path.join(app.config['UPLOAD_FOLDER'], filename))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)