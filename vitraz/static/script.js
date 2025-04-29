let pieces = [];
let colorGroups = {};
let originalImage = new Image();
let workspacePieces = [];
let previewSplitX = 0;
let replicaImage = null;

document.getElementById('upload-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(this);

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        console.log('HTTP status:', response.status);
        return response.json();
    })
    .then(data => {
        console.log('Odpověď od backendu:', data);

        if (data.error) {
            document.getElementById('error-message').textContent = data.error;
            console.error('Chyba v odpovědi:', data.error);
            return;
        }

        pieces = data.pieces || [];
        colorGroups = data.color_groups || {};
        originalImage.src = data.image_path || '';


        if (pieces.length === 0) {
            document.getElementById('error-message').textContent = 'Žádná sklíčka nenalezena.';
            return;
        }

        if (!originalImage.src) {
            document.getElementById('error-message').textContent = 'Chyba při načítání obrázku: Cesta k obrázku není platná.';
            return;
        }

        originalImage.onload = function() {
            console.log('Obrázek načten:', originalImage.src);
            document.getElementById('content').style.display = 'block';
            setupCanvases();
            displayInfo();
            drawOriginal();
            updateReplica();
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

    originalCanvas.width = originalImage.width;
    originalCanvas.height = originalImage.height;
    workspaceCanvas.width = originalImage.width;
    workspaceCanvas.height = originalImage.height;
    previewCanvas.width = originalImage.width;
    previewCanvas.height = originalImage.height;

    originalCanvas.addEventListener('mousemove', highlightPieces);
    originalCanvas.addEventListener('mousedown', startDragging);
    workspaceCanvas.addEventListener('mousemove', dragPiece);
    workspaceCanvas.addEventListener('mouseup', stopDragging);
    workspaceCanvas.addEventListener('contextmenu', removePiece);
    workspaceCanvas.addEventListener('click', colorPieceOnWorkspace);
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
let offsetX, offsetY;

function startDragging(e) {
    e.preventDefault();
    const canvas = document.getElementById('original-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    console.log('Kliknuto na original-canvas, souřadnice:', x, y);

    draggedPiece = null;

    const workspaceCanvas = document.getElementById('workspace-canvas');
    const workspaceRect = workspaceCanvas.getBoundingClientRect();
    const workspaceX = e.clientX - workspaceRect.left;
    const workspaceY = e.clientY - workspaceRect.top;

    for (const piece of workspacePieces) {
        const path = new Path2D();
        const ctx = workspaceCanvas.getContext('2d');
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate((piece.rotation * Math.PI) / 180);
        piece.contour.forEach((point, idx) => {
            const adjustedX = point.x - piece.x;
            const adjustedY = point.y - piece.y;
            if (idx === 0) path.moveTo(adjustedX, adjustedY);
            else path.lineTo(adjustedX, adjustedY);
        });
        path.closePath();
        ctx.restore();
        if (ctx.isPointInPath(path, workspaceX, workspaceY)) {
            draggedPiece = piece;
            const dx = workspaceX - piece.x;
            const dy = workspaceY - piece.y;
            const angle = (piece.rotation * Math.PI) / 180;
            offsetX = dx * Math.cos(-angle) - dy * Math.sin(-angle);
            offsetY = dx * Math.sin(-angle) + dy * Math.cos(-angle);
            console.log('Přetahuje se existující sklíčko:', piece.id);
            break;
        }
    }

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
                    x: workspaceCanvas.width / 2,
                    y: workspaceCanvas.height / 2,
                    rotation: 0
                };
                offsetX = 0;
                offsetY = 0;
                workspacePieces.push(draggedPiece);
                console.log('Nové sklíčko přidáno do workspacePieces:', draggedPiece);
                break;
            }
        }
    }

    drawWorkspace();
    updateReplica();
}

function dragPiece(e) {
    if (!draggedPiece) return;

    const canvas = document.getElementById('workspace-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const angle = (draggedPiece.rotation * Math.PI) / 180;
    const dx = x - (draggedPiece.x + offsetX * Math.cos(angle) - offsetY * Math.sin(angle));
    const dy = y - (draggedPiece.y + offsetX * Math.sin(angle) + offsetY * Math.cos(angle));
    draggedPiece.x += dx;
    draggedPiece.y += dy;

    console.log('Přetahování sklíčka, nová pozice:', draggedPiece.x, draggedPiece.y);
    drawWorkspace();
    updateReplica();
}

function stopDragging() {
    if (draggedPiece) {
        if (confirm('Otočit sklíčko o 90°?')) {
            draggedPiece.rotation = (draggedPiece.rotation + 90) % 360;
            console.log('Sklíčko otočeno, rotace:', draggedPiece.rotation);
            updateReplica();
        }
    }
    draggedPiece = null;
    drawWorkspace();
    updateReplica();
}

function removePiece(e) {
    e.preventDefault();
    const canvas = document.getElementById('workspace-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (let i = 0; i < workspacePieces.length; i++) {
        const piece = workspacePieces[i];
        const path = new Path2D();
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate((piece.rotation * Math.PI) / 180);
        piece.contour.forEach((point, idx) => {
            const adjustedX = point.x - piece.x;
            const adjustedY = point.y - piece.y;
            if (idx === 0) path.moveTo(adjustedX, adjustedY);
            else path.lineTo(adjustedX, adjustedY);
        });
        path.closePath();
        ctx.restore();
        if (ctx.isPointInPath(path, x, y)) {
            if (confirm('Odstranit toto sklíčko z pracovní plochy?')) {
                workspacePieces.splice(i, 1);
                console.log('Sklíčko odstraněno z workspacePieces:', piece.id);
                drawWorkspace();
                updateReplica();
            }
            break;
        }
    }
}

function colorPieceOnWorkspace(e) {
    if (draggedPiece) return;

    const canvas = document.getElementById('workspace-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let selectedPiece = null;

    for (const piece of workspacePieces) {
        const path = new Path2D();
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate((piece.rotation * Math.PI) / 180);
        piece.contour.forEach((point, idx) => {
            const adjustedX = point.x - piece.x;
            const adjustedY = point.y - piece.y;
            if (idx === 0) path.moveTo(adjustedX, adjustedY);
            else path.lineTo(adjustedX, adjustedY);
        });
        path.closePath();
        ctx.restore();

        if (ctx.isPointInPath(path, x, y)) {
            selectedPiece = piece;
            console.log('Kliknuto na sklíčko na pracovní ploše:', piece.id);
            break;
        }
    }

    if (selectedPiece) {
        replaceColor(selectedPiece.id);
    } else {
        console.log('Žádné sklíčko nebylo vybráno na souřadnicích:', x, y);
    }
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
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    });

        console.log('Počet sklíček na workspace:', workspacePieces.length);
    }

function replaceColor(pieceId) {
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
            workspacePieces.forEach(wp => {
                const piece = pieces.find(p => p.id === wp.id);
                if (piece) {
                    wp.color = piece.catalog_rgb;
                    console.log('Barva sklíčka aktualizována na pracovní ploše:', wp.id, wp.color);
                }
            });
            displayInfo();
            drawOriginal();
            drawWorkspace();
            updateReplica();
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

function updateReplica() {
    fetch('/generate_replica', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            console.error('Chyba při generování repliky:', data.error);
            document.getElementById('error-message').textContent = 'Chyba při generování repliky: ' + data.error;
            return;
        }
        replicaImage = new Image();
        replicaImage.src = data.replica_path + '?t=' + new Date().getTime();
        replicaImage.onload = function() {
            console.log('Replika načtena:', replicaImage.src);
            updatePreview();
        };
        replicaImage.onerror = function() {
            console.error('Nepodařilo se načíst repliku:', data.replica_path);
            document.getElementById('error-message').textContent = 'Nepodařilo se načíst repliku: ' + data.replica_path;
        };
    })
    .catch(error => {
        console.error('Chyba při generování repliky:', error);
        document.getElementById('error-message').textContent = 'Chyba při generování repliky: ' + error.message;
    });
}

document.getElementById('save-plan').addEventListener('click', function() {
    console.log('Ukládání řezacího plánu, workspacePieces:', workspacePieces);
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
        replicaImage = new Image();
        replicaImage.src = data.replica_path + '?t=' + new Date().getTime();
        replicaImage.onload = function() {
            updatePreview();
        };
    })
    .catch(error => {
        console.error('Chyba při generování repliky:', error);
        document.getElementById('error-message').textContent = 'Chyba při generování repliky: ' + error.message;
    });
});

function updatePreview(e) {
    const canvas = document.getElementById('preview-canvas');
    const ctx = canvas.getContext('2d');
    if (e) {
        const rect = canvas.getBoundingClientRect();
        previewSplitX = e.clientX - rect.left;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, previewSplitX, canvas.height);
    ctx.clip();
    ctx.drawImage(originalImage, 0, 0);
    ctx.restore();

    if (replicaImage) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(previewSplitX, 0, canvas.width - previewSplitX, canvas.height);
        ctx.clip();
        ctx.drawImage(replicaImage, 0, 0);
        ctx.restore();
    } else {
        console.log('Replika není dostupná pro zobrazení v náhledu.');
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
}