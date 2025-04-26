let pieces = [];
let colorGroups = {};
let originalImage = new Image();
let workspacePieces = [];
let replicaImage = new Image();
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

document.getElementById('upload-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(this);

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        console.log('Odpověď od backendu:', data);
        if (data.error) {
            document.getElementById('error-message').textContent = data.error;
            return;
        }

        pieces = data.pieces || [];
        colorGroups = data.color_groups || {};
        originalImage.src = data.image_path + '?t=' + new Date().getTime();

        if (pieces.length === 0) {
            document.getElementById('error-message').textContent = 'Žádná sklíčka nenalezena.';
            return;
        }

        originalImage.onload = function() {
            console.log('Obrázek nač evidences:', originalImage.src);
            document.getElementById('content').style.display = 'block';
            setupCanvases();
            displayInfo();
            drawOriginal();
            updateReplica();
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
    previewCanvas.addEventListener('click', editReplicaPiece);
    previewCanvas.addEventListener('mousemove', updatePreview);

    console.log('Plátna nastavena:', originalCanvas.width, 'x', originalCanvas.height);
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
            pieceDiv.textContent = `Sklíčko ${piece.id} (RGB: ${piece.original_rgb.join(',')})`;
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

let draggedPiece = null;
let offsetX, offsetY;

function startDragging(e) {
    e.preventDefault();
    const canvas = document.getElementById('original-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    draggedPiece = null;

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
                x: x,
                y: y,
                rotation: 0
            };
            offsetX = 0;
            offsetY = 0;
            workspacePieces.push(draggedPiece);
            console.log('Sklíčko přidáno do workspace:', draggedPiece.id);
            drawWorkspace();
            updateReplica();
            break;
        }
    }
}

function dragPiece(e) {
    if (!draggedPiece) return;

    const canvas = document.getElementById('workspace-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    draggedPiece.x = x;
    draggedPiece.y = y;

    drawWorkspace();
    updateReplica();
}

function stopDragging() {
    if (draggedPiece && confirm('Otočit sklíčko o 90°?')) {
        draggedPiece.rotation = (draggedPiece.rotation + 90) % 360;
        console.log('Sklíčko otočeno:', draggedPiece.rotation);
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
            if (idx === 0) path.moveTo(point.x - piece.x, point.y - piece.y);
            else path.lineTo(point.x - piece.x, point.y - piece.y);
        });
        path.closePath();
        ctx.restore();
        if (ctx.isPointInPath(path, x, y)) {
            if (confirm('Odstranit sklíčko z pracovní plochy?')) {
                workspacePieces.splice(i, 1);
                fetch('/delete_piece', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ piece_id: piece.id })
                })
                .then(response => response.json())
                .then(data => {
                    pieces = data.pieces || [];
                    colorGroups = data.color_groups || {};
                    displayInfo();
                    drawOriginal();
                    drawWorkspace();
                    updateReplica();
                });
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

    for (const piece of workspacePieces) {
        const path = new Path2D();
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate((piece.rotation * Math.PI) / 180);
        piece.contour.forEach((point, idx) => {
            if (idx === 0) path.moveTo(point.x - piece.x, point.y - piece.y);
            else path.lineTo(point.x - piece.x, point.y - piece.y);
        });
        path.closePath();
        ctx.restore();
        if (ctx.isPointInPath(path, x, y)) {
            replaceColor(piece.id);
            break;
        }
    }
}

function editReplicaPiece(e) {
    const canvas = document.getElementById('preview-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const piece of pieces) {
        const path = new Path2D();
        piece.contour.forEach((point, idx) => {
            if (idx === 0) path.moveTo(point[0], point[1]);
            else path.lineTo(point[0], point[1]);
        });
        path.closePath();
        const ctx = canvas.getContext('2d');
        if (ctx.isPointInPath(path, x, y)) {
            replaceColor(piece.id);
            break;
        }
    }
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
                if (piece) wp.color = piece.catalog_rgb;
            });
            displayInfo();
            drawOriginal();
            drawWorkspace();
            updateReplica();
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

function updateReplica() {
    fetch('/generate_replica', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            document.getElementById('error-message').textContent = data.error;
            return;
        }
        replicaImage.src = data.replica_path + '?t=' + new Date().getTime();
        replicaImage.onload = function() {
            updatePreview();
        };
    });
}

document.getElementById('save-plan').addEventListener('click', function() {
    if (workspacePieces.length === 0) {
        alert('Žádná sklíčka na pracovní ploše!');
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
    });
});

function updatePreview(e) {
    const canvas = document.getElementById('preview-canvas');
    const ctx = canvas.getContext('2d');
    let splitX = canvas.width / 2;
    if (e) {
        const rect = canvas.getBoundingClientRect();
        splitX = e.clientX - rect.left;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, splitX, canvas.height);
    ctx.clip();
    ctx.drawImage(originalImage, 0, 0);
    ctx.restore();

    if (replicaImage.src) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(splitX, 0, canvas.width - splitX, canvas.height);
        ctx.clip();
        ctx.drawImage(replicaImage, 0, 0);
        ctx.restore();
    }
}