// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// State
let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.5;
let currentSelection = null;

// DOM Elements
const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');
const textLayerDiv = document.getElementById('text-layer');
const highlightLayerDiv = document.getElementById('highlight-layer');
const viewerContainer = document.getElementById('viewer-container');
const pageIndicator = document.getElementById('page-indicator');
const toolbar = document.getElementById('highlight-toolbar');

// Initialize
async function init() {
    // LOOK FOR PDF IN ROOT FOLDER
    const loadingTask = pdfjsLib.getDocument('book.pdf');
    pdfDoc = await loadingTask.promise;
    document.getElementById('page-jump').max = pdfDoc.numPages;
    
    loadChapters();
    queueRenderPage(pageNum);
    setupEventListeners();
}

// Render Page (Lazy Loading)
function renderPage(num) {
    pageRendering = true;
    pageIndicator.textContent = `Page ${num} / ${pdfDoc.numPages}`;

    pdfDoc.getPage(num).then(async (page) => {
        // Calculate scale to fit mobile width
        const viewport = page.getViewport({ scale: 1 });
        const containerWidth = viewerContainer.clientWidth - 20; 
        scale = containerWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale: scale });

        // Render Canvas
        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;
        
        // Position text and highlight layers exactly over canvas
        const offsetX = canvas.offsetLeft;
        const offsetY = canvas.offsetTop;

        textLayerDiv.style.width = scaledViewport.width + 'px';
        textLayerDiv.style.height = scaledViewport.height + 'px';
        textLayerDiv.style.left = offsetX + 'px';
        textLayerDiv.style.top = offsetY + 'px';
        
        highlightLayerDiv.style.width = scaledViewport.width + 'px';
        highlightLayerDiv.style.height = scaledViewport.height + 'px';
        highlightLayerDiv.style.left = offsetX + 'px';
        highlightLayerDiv.style.top = offsetY + 'px';

        const renderContext = { canvasContext: ctx, viewport: scaledViewport };
        const renderTask = page.render(renderContext);

        // Render Text Layer
        const textContent = await page.getTextContent();
        textLayerDiv.innerHTML = ''; 
        await pdfjsLib.renderTextLayer({
            textContent: textContent,
            container: textLayerDiv,
            viewport: scaledViewport,
            textDivs: []
        }).promise;

        await renderTask.promise;
        
        // Load offline highlights for this page
        loadHighlightsForPage(num);

        pageRendering = false;
        if (pageNumPending !== null) {
            renderPage(pageNumPending);
            pageNumPending = null;
        }
    });
}

function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}

// --- HIGHLIGHTING LOGIC ---
function setupEventListeners() {
    // Navigation
    document.getElementById('prev-page').onclick = () => { if (pageNum > 1) { pageNum--; queueRenderPage(pageNum); } };
    document.getElementById('next-page').onclick = () => { if (pageNum < pdfDoc.numPages) { pageNum++; queueRenderPage(pageNum); } };
    document.getElementById('page-jump').onchange = (e) => {
        const val = parseInt(e.target.value);
        if (val >= 1 && val <= pdfDoc.numPages) { pageNum = val; queueRenderPage(pageNum); }
    };

    // Sidebar
    document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.add('open');
    document.getElementById('close-sidebar').onclick = () => document.getElementById('sidebar').classList.remove('open');

    // Text Selection for Highlighting
    document.addEventListener('selectionchange', handleSelection);
    document.addEventListener('touchend', () => setTimeout(handleSelection, 100)); 
    
    // Toolbar buttons
    document.querySelectorAll('.hl-btn[data-color]').forEach(btn => {
        btn.onclick = () => saveHighlight(btn.dataset.color);
    });
    document.getElementById('cancel-hl-btn').onclick = () => {
        window.getSelection().removeAllRanges();
        toolbar.classList.add('hidden');
    };
    document.getElementById('add-comment-btn').onclick = () => {
        const comment = prompt("Add a comment:");
        if (comment) saveHighlight('yellow', comment);
    };
}

function handleSelection() {
    const selection = window.getSelection();
    if (selection.toString().trim().length > 0) {
        currentSelection = selection;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        toolbar.style.top = (rect.top - 50) + 'px';
        toolbar.style.left = Math.max(10, rect.left) + 'px';
        toolbar.classList.remove('hidden');
    } else {
        if (!toolbar.matches(':hover')) {
            toolbar.classList.add('hidden');
        }
    }
}

async function saveHighlight(color, comment = '') {
    if (!currentSelection) return;
    
    const range = currentSelection.getRangeAt(0);
    const rects = range.getClientRects();
    const text = currentSelection.toString().trim();
    
    const layerRect = highlightLayerDiv.getBoundingClientRect();
    const boxes = [];
    
    for (let i = 0; i < rects.length; i++) {
        boxes.push({
            top: rects[i].top - layerRect.top,
            left: rects[i].left - layerRect.left,
            width: rects[i].width,
            height: rects[i].height
        });
    }

    const highlightData = {
        id: Date.now(),
        page: pageNum,
        text: text,
        comment: comment,
        color: color,
        boxes: boxes
    };

    // Save to IndexedDB via localForage
    const key = `highlights_page_${pageNum}`;
    let pageHighlights = await localForage.getItem(key) || [];
    pageHighlights.push(highlightData);
    await localForage.setItem(key, pageHighlights);

    drawHighlight(highlightData);
    
    window.getSelection().removeAllRanges();
    toolbar.classList.add('hidden');
}

async function loadHighlightsForPage(page) {
    highlightLayerDiv.innerHTML = ''; 
    const key = `highlights_page_${page}`;
    const pageHighlights = await localForage.getItem(key) || [];
    
    pageHighlights.forEach(hl => drawHighlight(hl));
}

function drawHighlight(hlData) {
    hlData.boxes.forEach(box => {
        const div = document.createElement('div');
        div.className = `highlight-box ${hlData.color}`;
        div.style.top = box.top + 'px';
        div.style.left = box.left + 'px';
        div.style.width = box.width + 'px';
        div.style.height = box.height + 'px';
        
        if (hlData.comment) {
            div.title = hlData.comment; 
        }
        
        div.onclick = async () => {
            if (confirm(`Delete highlight?\nText: "${hlData.text}"\nComment: ${hlData.comment || 'None'}`)) {
                await deleteHighlight(hlData.id);
                div.remove();
            }
        };
        
        highlightLayerDiv.appendChild(div);
    });
}

async function deleteHighlight(id) {
    const key = `highlights_page_${pageNum}`;
    let pageHighlights = await localForage.getItem(key) || [];
    pageHighlights = pageHighlights.filter(hl => hl.id !== id);
    await localForage.setItem(key, pageHighlights);
}

// --- CHAPTERS ---
async function loadChapters() {
    // LOOK FOR JSON IN ROOT FOLDER
    const response = await fetch('chapters.json');
    const chapters = await response.json();
    const list = document.getElementById('chapter-list');
    
    chapters.forEach(ch => {
        const li = document.createElement('li');
        li.textContent = ch.title;
        li.onclick = () => {
            pageNum = ch.page;
            queueRenderPage(pageNum);
            document.getElementById('sidebar').classList.remove('open');
        };
        list.appendChild(li);
    });
}

// Start the app
init();