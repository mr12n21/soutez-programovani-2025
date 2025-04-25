let pieces = [];
let colorGroups = {};
let originalImage = new Image();
let workspacePieces = [];
let previewSplitX = 0;

document.getElementById('upload-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(this);

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        console.log('HTTP status:', response.status); // Debug log
        return response.json();
    })
    .then(data => {
        console.log('Odpověď od backendu:', data); // Debug log

        if (data.error) {
            document.getElementById('error-message').textContent = data.error;
            console.error('Chyba v odpovědi:', data.error);
            return;
        }

        // Uložení dat z odpovědi
        pieces = data.pieces || [];
        colorGroups = data.color_groups || {};
        originalImage.src = data.image_path || '';

        // Zobrazení obsahu pokud jsou data platná
        if (pieces.length === 0) {
            document.getElementById('error-message').textContent = 'Žádná sklíčka nenalezena.';
            return;
        }

        if (!originalImage.src) {
            document.getElementById('error-message').textContent = 'Chyba při načítání obrázku: Cesta k obrázku není platná.';
            return;
        }

        originalImage.onload = function() {
            console.log('Obrázek načten:', originalImage.src); // Debug log
            document.getElementById('content').style.display = 'block';
            setupCanvases();
            displayInfo();
            drawOriginal();
        };

        originalImage.onerror = function() {
            document.getElementById('error-message').textContent = 'Nepodařilo se načíst obrázek: ' + originalImage.src;
            console.error('Chyba při načítání obrázku:', originalImage.src);
        };
    })
    .catch(error => {
        document.getElementById('error-message').textContent = 'Chyba při analýze: ' + error.message;
        console.error('Chyba při fetch:', error);
    });
});

function setupCanvases() {
    const originalCanvas = document.getElementById('original-canvas');
    const workspaceCanvas = document.getElementById('workspace-canvas');
    const previewCanvas = document.getElementById('preview-canvas');

    if (!originalCanvas || !workspaceCanvas || !previewCanvas) {
        console.error('Plátna nenalezena!');
        document.getElementById('error-message').textContent = 'Chyba: Plátna (canvas) nenalezena v HTML.';
        return;
    }

    // Nastavení rozměrů plátna
    originalCanvas.width = originalImage.width;
    originalCanvas.height = originalImage.height;
    workspaceCanvas.width = originalImage.width;
    workspaceCanvas.height = originalImage.height;
    previewCanvas.width = originalImage.width;
    previewCanvas.height = originalImage.height;

    // Přidání událostí
    originalCanvas.addEventListener('mousemove', highlightPieces);
    originalCanvas.addEventListener('mousedown', startDragging); // Kliknutí na original-canvas
    workspaceCanvas.addEventListener('mousemove', dragPiece);
    workspaceCanvas.addEventListener('mouseup', stopDragging);
    previewCanvas.addEventListener('mousemove', updatePreview);

    console.log('Plátna nastavena, rozměry:', originalCanvas.width, 'x', originalCanvas.height);
}

function displayInfo() {
    const colorGroupsDiv = document.getElementById('color-groups');
    if (!colorGroupsDiv) {
        console.error('Element #color-groups nenalezen!');
        document.getElementById('error-message').textContent = 'Chyba: Element #color-groups nenalezen v HTML.';
        return;
    }

    colorGroupsDiv.innerHTML = '';
    for (const [color, group] of Object.entries(colorGroups)) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'color-group';
        groupDiv.innerHTML = `<strong>${color}</strong>: ${group.pieces.length} sklíček, ${group.percent_area}% plochy`;
        group.pieces.forEach(piece => {
            const pieceDiv = document.createElement('div');
            pieceDiv.className = 'piece';
            pieceDiv.textContent = `Sklíčko ${piece.id} (Původní RGB: ${piece.original_rgb.join(',')})`;
            pieceDiv.addEventListener('click', () => replaceColor(piece.id));
            groupDiv.appendChild(pieceDiv);
        });
        colorGroupsDiv.appendChild(groupDiv);
    }
    console.log('Informace o barvách zobrazeny:', colorGroups); // Debug log
}

function drawOriginal(highlightColor = null) {
    const canvas = document.getElementById('original-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalImage, 0, 0);

    pieces.forEach(piece => {
        if (highlightColor && piece.catalog_color === highlightColor) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.5)';
            ctx.beginPath();
            piece.contour.forEach((point, idx) => {
                if (idx === 0) ctx.moveTo(point[0], point[1]);
                else ctx.lineTo(point[0], point[1]);
            });
            ctx.closePath();
            ctx.fill();
        }
    });
}

function highlightPieces(e) {
    const canvas = document.getElementById('original-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let highlightColor = null;
    for (const piece of pieces) {
        const path = new Path2D();
        piece.contour.forEach((point, idx) => {
            if (idx === 0) path.moveTo(point[0], point[1]);
            else path.lineTo(point[0], point[1]);
        });
        path.closePath();
        const ctx = canvas.getContext('2d');
        if (ctx.isPointInPath(path, x, y)) {
            highlightColor = piece.catalog_color;
            break;
        }
    }
    drawOriginal(highlightColor);
}

let draggedPiece = null;
let offsetX, offsetY, rotation = 0;

function startDragging(e) {
    const canvas = document.getElementById('original-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    console.log('Kliknuto na original-canvas, souřadnice:', x, y); // Debug log

    draggedPiece = null;

    // Nejprve zkontrolujeme, zda přetahujeme již existující sklíčko na workspace-canvas
    const workspaceCanvas = document.getElementById('workspace-canvas');
    const workspaceRect = workspaceCanvas.getBoundingClientRect();
    const workspaceX = e.clientX - workspaceRect.left;
    const workspaceY = e.clientY - workspaceRect.top;

    for (const piece of workspacePieces) {
        const path = new Path2D();
        piece.contour.forEach((point, idx) => {
            if (idx === 0) path.moveTo(point.x, point.y);
            else path.lineTo(point.x, point.y);
        });
        path.closePath();
        const ctx = workspaceCanvas.getContext('2d');
        if (ctx.isPointInPath(path, workspaceX, workspaceY)) {
            draggedPiece = piece;
            offsetX = workspaceX - piece.x;
            offsetY = workspaceY - piece.y;
            console.log('Přetahuje se existující sklíčko:', piece.id); // Debug log
            break;
        }
    }

    // Pokud nepřetahujeme existující sklíčko, přidáme nové z original-canvas
    if (!draggedPiece) {
        for (const piece of pieces) {
            const path = new Path2D();
            piece.contour.forEach((point, idx) => {
                if (idx === 0) path.moveTo(point[0], point[1]);
                else path.lineTo(point[0], point[1]);
            });
            path.closePath();
            const ctx = canvas.getContext('2d');
            if (ctx.isPointInPath(path, x, y)) {
                draggedPiece = {
                    id: piece.id,
                    contour: piece.contour.map(pt => ({x: pt[0], y: pt[1]})),
                    color: piece.catalog_rgb,
                    x: workspaceCanvas.width / 2, // Umístíme na střed pracovní plochy
                    y: workspaceCanvas.height / 2,
                    rotation: 0
                };
                offsetX = 0;
                offsetY = 0;
                workspacePieces.push(draggedPiece);
                console.log('Nové sklíčko přidáno do workspacePieces:', draggedPiece); // Debug log
                break;
            }
        }
    }

    drawWorkspace();
}

function dragPiece(e) {
    if (!draggedPiece) return;

    const canvas = document.getElementById('workspace-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    draggedPiece.x = x - offsetX;
    draggedPiece.y = y - offsetY;
    console.log('Přetahování sklíčka, nová pozice:', draggedPiece.x, draggedPiece.y); // Debug log
    drawWorkspace();
}

function stopDragging() {
    if (draggedPiece) {
        if (confirm('Otočit sklíčko o 90°?')) {
            draggedPiece.rotation = (draggedPiece.rotation + 90) % 360;
            console.log('Sklíčko otočeno, rotace:', draggedPiece.rotation); // Debug log
        }
    }
    draggedPiece = null;
    drawWorkspace();
}

function drawWorkspace() {
    const canvas = document.getElementById('workspace-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    workspacePieces.forEach(piece => {
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate((piece.rotation * Math.PI) / 180);
        ctx.beginPath();
        piece.contour.forEach((point, idx) => {
            if (idx === 0) ctx.moveTo(point.x - piece.x, point.y - piece.y);
            else ctx.lineTo(point.x - piece.x, point.y - piece.y);
        });
        ctx.closePath();
        ctx.fillStyle = `rgb(${piece.color[0]},${piece.color[1]},${piece.color[2]})`;
        ctx.fill();
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2; // Silnější okraje pro lepší viditelnost
        ctx.stroke();
        ctx.restore();
    });

    console.log('Počet sklíček na workspace:', workspacePieces.length); // Debug log
}

function replaceColor(pieceId) {
    // Vytvoříme dialog pro výběr barvy
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
    modal.style.zIndex = '1000';

    const modalContent = document.createElement('div');
    modalContent.style.backgroundColor = '#fff';
    modalContent.style.margin = '15% auto';
    modalContent.style.padding = '20px';
    modalContent.style.width = '300px';
    modalContent.style.borderRadius = '5px';

    const title = document.createElement('h3');
    title.textContent = 'Vyberte novou barvu:';
    modalContent.appendChild(title);

    const select = document.createElement('select');
    select.id = 'color-select';
    for (const [colorName, rgb] of Object.entries(COLOR_CATALOG)) {
        const option = document.createElement('option');
        option.value = colorName;
        option.textContent = colorName;
        option.style.backgroundColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        select.appendChild(option);
    }
    modalContent.appendChild(select);

    const buttonDiv = document.createElement('div');
    buttonDiv.style.marginTop = '20px';

    const confirmButton = document.createElement('button');
    confirmButton.textContent = 'Potvrdit';
    confirmButton.style.marginRight = '10px';
    confirmButton.addEventListener('click', () => {
        const newColor = document.getElementById('color-select').value;
        fetch('/replace_color', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ piece_id: pieceId, new_color: newColor })
        })
        .then(response => response.json())
        .then(data => {
            pieces = data.pieces || [];
            colorGroups = data.color_groups || {};
            displayInfo();
            drawOriginal();
            drawWorkspace(); // Aktualizace pracovní plochy
            document.body.removeChild(modal);
        })
        .catch(error => {
            console.error('Chyba při náhradě barvy:', error);
            document.getElementById('error-message').textContent = 'Chyba při náhradě barvy: ' + error.message;
            document.body.removeChild(modal);
        });
    });
    buttonDiv.appendChild(confirmButton);

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Zrušit';
    cancelButton.addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    buttonDiv.appendChild(cancelButton);

    modalContent.appendChild(buttonDiv);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
}

document.getElementById('save-plan').addEventListener('click', function() {
    console.log('Ukládání řezacího plánu, workspacePieces:', workspacePieces); // Debug log
    if (workspacePieces.length === 0) {
        alert('Žádná sklíčka nejsou na pracovní ploše! Přetáhněte sklíčka na pracovní plochu a poté uložte plán.');
        return;
    }

    fetch('/save_plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: workspacePieces })
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
        const a = document.createElement('a');
        a.href = '/download/cutting_plan.json';
        a.download = 'cutting_plan.json';
        a.click();
    })
    .catch(error => {
        console.error('Chyba při ukládání plánu:', error);
        document.getElementById('error-message').textContent = 'Chyba při ukládání plánu: ' + error.message;
    });
});

document.getElementById('generate-replica').addEventListener('click', function() {
    fetch('/generate_replica', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
            return;
        }
        const a = document.createElement('a');
        a.href = '/download/replica.png';
        a.download = 'replica.png';
        a.click();
        drawPreview(data.replica_path);
    })
    .catch(error => {
        console.error('Chyba při generování repliky:', error);
        document.getElementById('error-message').textContent = 'Chyba při generování repliky: ' + error.message;
    });
});

function updatePreview(e) {
    const canvas = document.getElementById('preview-canvas');
    const rect = canvas.getBoundingClientRect();
    previewSplitX = e.clientX - rect.left;
    drawPreview();
}

function drawPreview(replicaPath = null) {
    const canvas = document.getElementById('preview-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Původní vitráž vlevo
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, previewSplitX, canvas.height);
    ctx.clip();
    ctx.drawImage(originalImage, 0, 0);
    ctx.restore();

    // Replika vpravo
    if (replicaPath) {
        const replicaImage = new Image();
        replicaImage.src = replicaPath;
        replicaImage.onload = function() {
            ctx.save();
            ctx.beginPath();
            ctx.rect(previewSplitX, 0, canvas.width - previewSplitX, canvas.height);
            ctx.clip();
            ctx.drawImage(replicaImage, 0, 0);
            ctx.restore();
        };
        replicaImage.onerror = function() {
            document.getElementById('error-message').textContent = 'Nepodařilo se načíst repliku: ' + replicaPath;
        };
    }
}

const COLOR_CATALOG = {
    "maroon": [128, 0, 0],
    "red": [255, 0, 0],
    "orange": [255, 165, 0],
    "yellow": [255, 255, 0],
    "olive": [128, 128, 0],
    "purple": [128, 0, 128],
    "fuchsia": [255, 0, 255],
    "white": [255, 255, 255],
    "lime": [0, 255, 0],
    "green": [0, 128, 0],
    "navy": [0, 0, 128],
    "blue": [0, 0, 255],
    "aqua": [0, 255, 255],
    "teal": [0, 128, 128],
    "black": [0, 0, 0],
    "silver": [192, 192, 192]
};