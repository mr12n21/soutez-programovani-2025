# LOGIK
Logik je webová logická hra vytvořená v Pythonu s použitím frameworku Flask. Hráč hádá tajnou kombinaci barev (4 nebo 5 kamenů) a dostává zpětnou vazbu buď formou černých/bílých kamenů (bez přesné pozice), nebo čísel (přesná pozice). Hra podporuje opakování barev, různé obtížnosti a administrátorský přístup pro zobrazení tajné kombinace.


### Návod na spuštění

Hra je zabalena do Docker kontejneru a používá Docker Compose pro snadné spuštění.

#### Požadavky:

- Docker
- Docker Compose

#### Kroky pro build a spuštění
    docker-compose build
    docker-compose up

Tento příkaz spustí Flask aplikaci na portu 5000. Pro spuštění na pozadí použijte:

    docker-compose up -d

Zastavení kontejneru:

    docker-compose down

### Jak začít hrát
Otevřete prohlížeč a přejděte na:

    http://localhost:5000

#### Na domovské stránce:

Vyberte obtížnost (4 nebo 5 kamenů).
Zvolte, zda mohou být barvy opakovány (Ano nebo Ne).

#### Vyberte způsob hodnocení:

Bez přesné pozice (výchozí, černé/bílé kameny).
Přesná pozice (čísla 1 pro správnou barvu a pozici, 0 jinak).
Zaškrtněte „Generovat náhodně“ nebo zadejte vlastní kombinaci.
Klikněte na Spustit hru pro přechod na herní plochu.

#### Na herní ploše:

Zadávejte pokusy výběrem barev.

Zpětná vazba se zobrazí podle zvoleného hodnocení.


Hra končí po uhodnutí kombinace nebo po 10 pokusech.

### Zobrazení tajné kombinace přes /admin

Administrátor může zobrazit tajnou kombinaci aktuální hry přes speciální endpoint.

Přejděte na:

- http://localhost:5000/admin

- Heslo: admin123

Po zadání správného hesla se zobrazí tajná kombinace (barevné kameny a názvy barev, např. „červená, modrá, zelená, žlutá“).

Pokud není aktivní hra, zobrazí se zpráva „Žádná aktivní hra!“. Pokud zadáte špatné heslo, zobrazí se „Špatné heslo!“.

Poznámka: Heslo je pevně nastavené pro jednoduchost. V produkčním prostředí doporučujeme použít bezpečnější autentizaci.

## Authors

- [@mr12n21](https://www.github.com/octokatherine)
