from fastapi import FastAPI, HTTPException, Request, Form
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import requests
import json
import asyncio

# Inicializace FastAPI a Jinja2 šablon
app = FastAPI()
templates = Jinja2Templates(directory="templates")

# Načtení konfigurace
try:
    with open("config.json", "r") as f:
        config = json.load(f)
    PLAYER_ID = config["playerId"]
    SERVER_URL = config["serverUrl"]
except FileNotFoundError:
    raise Exception("Soubor config.json neexistuje")
except KeyError:
    raise Exception("Chybí klíče 'playerId' nebo 'serverUrl' v config.json")

# Modely pro API požadavky
class PlayerRequest(BaseModel):
    playerId: str

class SessionRequest(BaseModel):
    playerId: str
    sessionId: str

class NewSessionRequest(BaseModel):
    playerId: str
    mapName: str
    type: str

class PlayMoveRequest(BaseModel):
    playerId: str
    sessionId: str
    direction: int

# Globální proměnné pro stav hry
current_session = {"sessionId": None, "teamsColor": None}

async def poll_game_state(session_id: str) -> dict:
    """
    Pravidelně kontroluje stav hry a vrací stav a skóre, pokud je hra ukončena.
    Vrací: {'state': 'Ready'/'Waiting'/'GameOver', 'score': {Red: int, Blue: int} pokud GameOver}
    """
    while True:
        try:
            response = requests.post(
                f"{SERVER_URL}/Game/State",
                json={"playerId": PLAYER_ID, "sessionId": session_id},
                timeout=5
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=response.text)
            state = response.json()
            if state in ["Ready", "GameOver"]:
                result = {"state": state}
                if state == "GameOver":
                    score_response = requests.post(
                        f"{SERVER_URL}/Game/Score",
                        json={"playerId": PLAYER_ID, "sessionId": session_id},
                        timeout=5
                    )
                    if score_response.status_code == 200:
                        result["score"] = score_response.json()
                return result
            await asyncio.sleep(2)  # Čekání 2 sekundy před další kontrolou
        except requests.RequestException as e:
            raise HTTPException(status_code=500, detail=f"Chyba při komunikaci se serverem: {str(e)}")

@app.get("/", response_class=HTMLResponse)
async def get_maps(request: Request):
    """
    Zobrazí seznam map dostupných na serveru a formulář pro spuštění hry.
    """
    try:
        response = requests.post(
            f"{SERVER_URL}/Game/AllMaps",
            json={"playerId": PLAYER_ID},
            timeout=5
        )
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)
        maps = response.json()
        print(f"Načtené mapy: {maps}")  # Ladící výstup
        return templates.TemplateResponse("index.html", {"request": request, "maps": maps})
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Chyba při načítání map: {str(e)}")

@app.post("/start-game", response_class=HTMLResponse)
async def start_game(request: Request, map_name: str = Form(...)):
    """
    Vytvoří novou herní relaci a otevře herní stránku v novém okně.
    """
    if not map_name:
        raise HTTPException(status_code=400, detail="Není vybrána žádná mapa")

    try:
        response = requests.post(
            f"{SERVER_URL}/Game/CreateSession",
            json={"playerId": PLAYER_ID, "mapName": map_name, "type": "Manual"},
            timeout=5
        )
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)
        session_data = response.json()
        current_session["sessionId"] = session_data["sessionId"]
        current_session["teamsColor"] = session_data["teamsColor"]

        # Načtení mapy pro ladění
        map_response = requests.post(
            f"{SERVER_URL}/Game/Map",
            json={"playerId": PLAYER_ID, "sessionId": session_data["sessionId"]},
            timeout=5
        )
        if map_response.status_code == 200:
            map_data = map_response.json()
            print(f"Načtená mapa: width={map_data['width']}, height={map_data['height']}, cells={map_data['cells']}")

        state = await poll_game_state(session_data["sessionId"])
        return templates.TemplateResponse(
            "game.html",
            {
                "request": request,
                "session_id": session_data["sessionId"],
                "game_url": f"{SERVER_URL}/Session/{session_data['sessionId']}",
                "state": state["state"],
                "teams_color": session_data["teamsColor"],
                "player_id": PLAYER_ID,
                "score": state.get("score", None)
            }
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Chyba při vytváření relace: {str(e)}")

@app.post("/move")
async def make_move(move: PlayMoveRequest):
    """
    Provede tah hráče a vrátí nový stav hry.
    """
    if move.playerId != PLAYER_ID or move.sessionId != current_session["sessionId"]:
        raise HTTPException(status_code=400, detail="Neplatné ID hráče nebo relace")
    if move.direction < 1 or move.direction > 6:
        raise HTTPException(status_code=400, detail="Směr musí být mezi 1 a 6")

    try:
        response = requests.post(f"{SERVER_URL}/Game/Move", json=move.dict(), timeout=5)
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)

        state = await poll_game_state(move.sessionId)
        return {"state": state["state"], "score": state.get("score", None), "move_success": response.json()}
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Chyba při provádění tahu: {str(e)}")

@app.get("/game-state", response_class=HTMLResponse)
async def get_game_state(request: Request):
    """
    Zobrazí aktuální stav hry a aktualizuje rozhraní.
    """
    if not current_session["sessionId"]:
        raise HTTPException(status_code=400, detail="Žádná aktivní relace")

    try:
        state = await poll_game_state(current_session["sessionId"])
        return templates.TemplateResponse(
            "game.html",
            {
                "request": request,
                "session_id": current_session["sessionId"],
                "game_url": f"{SERVER_URL}/Session/{current_session['sessionId']}",
                "state": state["state"],
                "teams_color": current_session["teamsColor"],
                "player_id": PLAYER_ID,
                "score": state.get("score", None)
            }
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Chyba při načítání stavu hry: {str(e)}")

@app.get("/favicon.ico")
async def favicon():
    """
    Zpracuje požadavek na favicon.ico, aby se zabránilo 404 chybám.
    """
    return {"message": "No favicon available"}
