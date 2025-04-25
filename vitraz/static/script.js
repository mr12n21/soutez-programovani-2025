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
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            document.getElementById('error-message').textContent = data.error;
            return;
        }

        pieces = data.pieces;
        colorGroups = data.color_groups;
        originalImage.src = data.image_path;
        document.getElementById('content').style.display = 'block';

        originalImage.onload = function() {
            setupCanvases();
            displayInfo();
            drawOriginal();
        };
    })
    .catch(error => {
        document.getElementById('error-message').textContent = 'Chyba při analýze: ' + error.message;
        console.error('Chyba:', error);
    });
});

function setupCanvases() {
    const originalCanvas = document.getElementById('original-canvas');
    const workspaceCanvas = document.getElementById('workspace-canvas');
    const previewCanvas = document.getElementById('preview-canvas');

    originalCanvas.width = originalImage.width;
    originalCanvas.height = originalImage.height;
    workspaceCanvas.width = originalImage.width;
    workspaceCanvas.height = originalImage.height;
    previewCanvas.width = originalImage.width;
    previewCanvas.height = originalImage.height;

    originalCanvas.addEventListener('mousemove', highlightPieces);
    workspaceCanvas.addEventListener('mousedown', startDragging);
    workspaceCanvas.addEventListener('mousemove', dragPiece);
    workspaceCanvas.addEventListener('mouseup', stopDragging);
    previewCanvas.addEventListener('mousemove', updatePreview);
}

function displayInfo() {
    const colorGroupsDiv = document.getElementById('color-groups');
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

function replaceColor(pieceId) {
    const newColor = prompt('Zadejte novou barvu z katalogu (např. aqua, red):');
    if (!newColor || !Object.keys(COLOR_CATALOG).includes(newColor)) {
        alert('Neplatná barva! Vyberte z katalogu (např. aqua, red).');
        return;
    }

    fetch('/replace_color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piece_id: pieceId, new_color: newColor })
    })
    .then(response => response.json())
    .then(data => {
        pieces = data.pieces;
        colorGroups = data.color_groups;
        displayInfo();
        drawOriginal();
    })
    .catch(error => {
        console.error('Chyba při náhradě barvy:', error);
    });
}

let draggedPiece = null;
let offsetX, offsetY, rotation = 0;

function startDragging(e) {
    const canvas = document.getElementById('workspace-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    draggedPiece = null;
    for (const piece of workspacePieces) {
        const path = new Path2D();
        piece.contour.forEach((point, idx) => {
            if (idx === 0) path.moveTo(point.x, point.y);
            else path.lineTo(point.x, point.y);
        });
        path.closePath();
        const ctx = canvas.getContext('2d');
        if (ctx.isPointInPath(path, x, y)) {
            draggedPiece = piece;
            offsetX = x - piece.x;
            offsetY = y - piece.y;
            break;
        }
    }

    if (!draggedPiece) {
        // Přidání nového sklíčka na pracovní plochu
        for (const piece of pieces) {
            const path = new Path2D();
            piece.contour.forEach((point, idx) => {
                if (idx === 0) path.moveTo(point[0], point[1]);
                else path.lineTo(point[0], point[1]);
            });
            path.closePath();
            const ctx = document.getElementById('original-canvas').getContext('2d');
            if (ctx.isPointInPath(path, x, y)) {
                draggedPiece = {
                    id: piece.id,
                    contour: piece.contour.map(pt => ({x: pt[0], y: pt[1]})),
                    color: piece.catalog_rgb,
                    x: x,
                    y: y,
                    rotation: 0
                };
                offsetX = x - draggedPiece.x;
                offsetY = y - draggedPiece.y;
                workspacePieces.push(draggedPiece);
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
    drawWorkspace();
}

function stopDragging() {
    if (draggedPiece) {
        // Možnost otočení při uvolnění
        if (confirm('Otočit sklíčko o 90°?')) {
            draggedPiece.rotation = (draggedPiece.rotation + 90) % 360;
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
        ctx.stroke();
        ctx.restore();
    });
}

document.getElementById('save-plan').addEventListener('click', function() {
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