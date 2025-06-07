import requests
import json
import time
import random
import heapq
from typing import Tuple, List, Optional, Dict, Set
from collections import deque

class AIBot:
    def __init__(self, player_id: str, server_url: str, session_id: str, team_color: str):
        """
        Inicializuje AI bota pro hru Vlajkobití s důslednou analýzou pohybu.

        Args:
            player_id: ID hráče.
            server_url: URL herního serveru.
            session_id: ID aktuální herní relace.
            team_color: Barva týmu ("Red" nebo "Blue").
        """
        self.player_id = player_id
        self.server_url = server_url
        self.session_id = session_id
        self.team_color = team_color
        self.headers = {"Content-Type": "application/json"}
        self.opponent_color = "Blue" if team_color == "Red" else "Red"
        self.position_history: deque = deque(maxlen=10)  # Historie pozic bota
        self.last_position = None
        self.stuck_counter = 0
        self.game_map = {"width": 11, "height": 6, "cells": []}  # 11x6 podle obrázku
        self.opponent_history: deque = deque(maxlen=5)  # Historie pozic soupeře
        self.first_move_done = False  # Flag pro první tah

    def send_post_request(self, endpoint: str, data: dict) -> dict:
        """Odešle POST požadavek na server a vrátí odpověď jako JSON."""
        try:
            response = requests.post(
                f"{self.server_url}{endpoint}",
                headers=self.headers,
                json=data,
                timeout=2
            )
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Chyba {response.status_code}: {response.text}")
                return {}
        except requests.exceptions.RequestException as e:
            print(f"Chyba při komunikaci se serverem: {e}")
            return {}

    def get_game_state(self) -> str:
        """Získá aktuální stav hry (Ready/Waiting/GameOver)."""
        data = {"playerId": self.player_id, "sessionId": self.session_id}
        response = self.send_post_request("/Game/State", data)
        if isinstance(response, str):
            return response
        return "GameOver"

    def get_entities(self) -> List[dict]:
        """Získá seznam entit (hráči, základny, vlajky)."""
        data = {"playerId": self.player_id, "sessionId": self.session_id}
        response = self.send_post_request("/Game/Entities", data)
        print(f"Entities response: {response}")  # Ladění
        return response or []

    def get_score(self) -> dict:
        """Získá aktuální skóre."""
        data = {"playerId": self.player_id, "sessionId": self.session_id}
        return self.send_post_request("/Game/Score", data) or {}

    def make_move(self, direction: int) -> bool:
        """Provede pohyb hráče ve zvoleném směru."""
        data = {"playerId": self.player_id, "sessionId": self.session_id, "direction": direction}
        response = self.send_post_request("/Game/Move", data)
        return response is True

    def manhattan_distance(self, pos1: Tuple[int, int], pos2: Tuple[int, int]) -> int:
        """Vypočítá Manhattan vzdálenost mezi dvěma body."""
        x1, y1 = pos1
        x2, y2 = pos2
        return abs(x1 - x2) + abs(y1 - y2)

    def build_map_from_entities(self, entities: List[dict]) -> None:
        """Vytvoří reprezentaci mapy na základě entit a předpokladu zdí."""
        self.game_map["cells"] = [{"type": "Wall"} for _ in range(self.game_map["width"] * self.game_map["height"])]
        for entity in entities:
            x, y = entity["location"]["x"], entity["location"]["y"]
            index = y * self.game_map["width"] + x
            if 0 <= index < len(self.game_map["cells"]):
                self.game_map["cells"][index] = {"type": "Empty"}

    def get_opponent_position(self, entities: List[dict]) -> Optional[Tuple[int, int]]:
        """Najde aktuální pozici soupeře."""
        for entity in entities:
            if entity["type"] == "Player" and entity["teamColor"] == self.opponent_color:
                pos = (entity["location"]["x"], entity["location"]["y"])
                self.opponent_history.append(pos)
                return pos
        return None

    def find_target_position(self, entities: List[dict]) -> Optional[Tuple[int, int]]:
        """
        Najde cílovou pozici (vlajku soupeře nebo vlastní základnu) s ohledem na soupeře.

        Returns:
            Tuple (x, y) cílové pozice, nebo None, pokud není cíl nalezen.
        """
        my_pos = None
        opponent_flag = None
        my_base = None

        for entity in entities:
            loc = (entity["location"]["x"], entity["location"]["y"])
            if entity["type"] == "Player" and entity["teamColor"] == self.team_color:
                my_pos = loc
            elif entity["type"] == "Flag" and entity["teamColor"] == self.opponent_color:
                opponent_flag = loc
            elif entity["type"] == "Base" and entity["teamColor"] == self.team_color:
                my_base = loc

        self.position_history.append(my_pos)
        has_flag = my_pos == opponent_flag if my_pos and opponent_flag else False
        opponent_pos = self.get_opponent_position(entities)

        if opponent_pos and self.manhattan_distance(my_pos, opponent_pos) <= 2 and len(self.opponent_history) > 1:
            if my_pos != opponent_flag:
                return my_base
        return my_base if has_flag and my_base else opponent_flag

    def get_hex_directions(self, x: int, y: int) -> List[Tuple[int, int]]:
        """
        Vrátí možné posuny pro šestiúhelníkovou mřížku podle směrů 1-6.
        """
        directions = [
            (1, 0),   # 1: vpravo
            (1, -1),  # 2: vpravo nahoru
            (0, -1),  # 3: vlevo nahoru
            (-1, 0),  # 4: vlevo
            (-1, 1),  # 5: vlevo dolů
            (0, 1)    # 6: vpravo dolů
        ]
        if y % 2 == 0:  # Pro sudé řádky
            directions = [
                (1, 0),   # 1: vpravo
                (0, -1),  # 2: vpravo nahoru
                (-1, -1), # 3: vlevo nahoru
                (-1, 0),  # 4: vlevo
                (0, 1),   # 5: vlevo dolů
                (1, 1)    # 6: vpravo dolů
            ]
        return directions

    def a_star(self, start: Tuple[int, int], goal: Tuple[int, int], entities: List[dict]) -> List[Tuple[int, int]]:
        """
        Najde nejkratší cestu pomocí A* algoritmu s analýzou sousedních polí.
        """
        self.build_map_from_entities(entities)
        opponent_pos = self.get_opponent_position(entities)
        open_set = [(0, start)]  # (f_score, position)
        came_from: Dict[Tuple[int, int], Optional[Tuple[int, int]]] = {}
        g_score: Dict[Tuple[int, int], float] = {start: 0}
        f_score: Dict[Tuple[int, int], float] = {start: self.manhattan_distance(start, goal)}

        while open_set:
            current = heapq.heappop(open_set)[1]
            if current == goal:
                path = []
                while current in came_from:
                    path.append(current)
                    current = came_from[current]
                path.append(start)
                return path[::-1]

            x, y = current
            directions = self.get_hex_directions(x, y)
            for dx, dy in directions:
                neighbor = (x + dx, y + dy)
                if not (0 <= neighbor[0] < self.game_map["width"] and 0 <= neighbor[1] < self.game_map["height"]):
                    continue
                index = neighbor[1] * self.game_map["width"] + neighbor[0]
                if index >= len(self.game_map["cells"]) or self.game_map["cells"][index]["type"] == "Wall":
                    continue
                if opponent_pos == neighbor:  # Vyhnout se soupeři
                    continue

                tentative_g_score = g_score[current] + 1
                if neighbor not in g_score or tentative_g_score < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g_score
                    f_score[neighbor] = tentative_g_score + self.manhattan_distance(neighbor, goal)
                    heapq.heappush(open_set, (f_score[neighbor], neighbor))

        return []  # No path found

    def analyze_neighbors(self, my_pos: Tuple[int, int], entities: List[dict]) -> Dict[int, Tuple[int, int]]:
        """
        Analyzuje sousední políčka a vrátí mapování směrů na pozice.
        """
        x, y = my_pos
        neighbors = {}
        directions = self.get_hex_directions(x, y)
        self.build_map_from_entities(entities)
        opponent_pos = self.get_opponent_position(entities)

        for idx, (dx, dy) in enumerate(directions, 1):
            new_x, new_y = x + dx, y + dy
            if 0 <= new_x < self.game_map["width"] and 0 <= new_y < self.game_map["height"]:
                index = new_y * self.game_map["width"] + new_x
                if index < len(self.game_map["cells"]) and self.game_map["cells"][index]["type"] == "Empty":
                    if opponent_pos != (new_x, new_y):  # Vyhnout se soupeři
                        neighbors[idx] = (new_x, new_y)
        return neighbors

    def choose_direction(self, my_pos: Tuple[int, int], target_pos: Tuple[int, int], entities: List[dict]) -> int:
        """
        Vybere směr pohybu na základě analýzy sousedů a A* cesty.
        """
        if not target_pos or my_pos == target_pos:
            neighbors = self.analyze_neighbors(my_pos, entities)
            return random.choice(list(neighbors.keys())) if neighbors else random.choice([1, 2, 3, 4, 5, 6])

        path = self.a_star(my_pos, target_pos, entities)
        if not path or len(path) < 2:
            neighbors = self.analyze_neighbors(my_pos, entities)
            return random.choice(list(neighbors.keys())) if neighbors else random.choice([1, 2, 3, 4, 5, 6])

        next_pos = path[1]
        x, y = my_pos
        dx = next_pos[0] - x
        dy = next_pos[1] - y
        directions = self.get_hex_directions(x, y)
        for i, (dir_dx, dir_dy) in enumerate(directions, 1):
            if (dx, dy) == (dir_dx, dir_dy):
                return i
        neighbors = self.analyze_neighbors(my_pos, entities)
        return random.choice(list(neighbors.keys())) if neighbors else random.choice([1, 2, 3, 4, 5, 6])

    def play_game(self):
        """Hlavní herní smyčka pro AI bota."""
        print(f"AI bot spustěn pro tým {self.team_color}, session ID: {self.session_id} at {time.strftime('%H:%M:%S', time.localtime())}")
        while True:
            state = self.get_game_state()
            if state == "GameOver":
                score = self.get_score()
                print(f"Hra skončila. Skóre: Červený: {score.get('Red', 0)}, Modrý: {score.get('Blue', 0)}")
                break
            elif state == "Waiting":
                time.sleep(0.01)
                continue
            elif state == "Ready":
                entities = self.get_entities()
                score = self.get_score()
                print(f"Aktuální skóre: Červený: {score.get('Red', 0)}, Modrý: {score.get('Blue', 0)}")

                my_pos = None
                for entity in entities:
                    if entity["type"] == "Player" and entity["teamColor"] == self.team_color:
                        my_pos = (entity["location"]["x"], entity["location"]["y"])
                        break

                if not my_pos:
                    print("Hráč nebyl nalezen, pokračuji.")
                    time.sleep(0.01)
                    continue

                self.position_history.append(my_pos)
                if my_pos == self.last_position:
                    self.stuck_counter += 1
                else:
                    self.stuck_counter = 0
                self.last_position = my_pos

                if self.stuck_counter >= 3:
                    print("Bot je zaseknutý, zkouším náhodný směr.")
                    direction = random.choice([1, 2, 3, 4, 5, 6])
                    self.stuck_counter = 0
                else:
                    target_pos = self.find_target_position(entities)
                    if not target_pos:
                        print("Cílová pozice nenalezena, čekám.")
                        time.sleep(0.01)
                        continue

                    # Komplexní analýza a optimalizace po nalezení pozice
                    if my_pos:  # Po nalezení pozice provedeme analýzu a optimalizaci
                        print(f"Analyzuji pozici {my_pos} a hledám trasu k {target_pos}")
                        direction = self.choose_direction(my_pos, target_pos, entities)

                print(f"Pohybuji se směrem: {direction} z pozice {my_pos} směrem k {target_pos}")
                if self.make_move(direction):
                    print("Pohyb proveden.")
                else:
                    print("Pohyb se nezdařil.")
                time.sleep(0.01)
