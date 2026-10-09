// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// State
let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.5;
let currentSelection = null;
let autoscrollInterval = null;

// DOM Elements
const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');
const textLayerDiv = document.getElementById('text-layer');
const highlightLayerDiv = document.getElementById('highlight-layer');
const pageWrapper = document.getElementById('page-wrapper');
const viewerContainer = document.getElementById('viewer-container');
const pageIndicator = document.getElementById('page-indicator');
const toolbar = document.getElementById('highlight-toolbar');
const autoscrollBtn = document.getElementById('autoscroll-btn');

// Initialize
async function init() {
    const loadingTask = pdfjsLib.getDocument('book.pdf');
    pdfDoc = await loadingTask.promise;
    document.getElementById('page-jump').max = pdfDoc.numPages;
    
    loadChapters();
    queueRenderPage(pageNum);
    setupEventListeners();
}

// Render Page
function renderPage(num) {
    pageRendering = true;
    pageIndicator.textContent = `Page ${num} / ${pdfDoc.numPages}`;
    pageWrapper.classList.add('turning'); // Preview transition

    pdfDoc.getPage(num).then(async (page) => {
        const viewport = page.getViewport({ scale: 1 });
        const containerWidth = viewerContainer.clientWidth - 20; 
        scale = containerWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale: scale });

        // Set wrapper and canvas dimensions
        pageWrapper.style.width = scaledViewport.width + 'px';
        pageWrapper.style.height = scaledViewport.height + 'px';
        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;

        // Set text/highlight layer dimensions to match full page
        textLayerDiv.style.width = scaledViewport.width + 'px';
        textLayerDiv.style.height = scaledViewport.height + 'px';
        highlightLayerDiv.style.width = scaledViewport.width + 'px';
        highlightLayerDiv.style.height = scaledViewport.height + 'px';

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
        
        loadHighlightsForPage(num);
        pageWrapper.classList.remove('turning');

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

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Page Jump
    document.getElementById('page-jump').onchange = (e) => {
        const val = parseInt(e.target.value);
        if (val >= 1 && val <= pdfDoc.numPages) { 
            pageNum = val; 
            queueRenderPage(pageNum); 
            viewerContainer.scrollTop = 0; // Reset scroll on jump
        }
    };

    // Sidebar
    document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.add('open');
    document.getElementById('close-sidebar').onclick = () => document.getElementById('sidebar').classList.remove('open');

    // Swipe Gestures for Page Turning
    let touchStartX = 0;
    let touchStartY = 0;

    viewerContainer.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    viewerContainer.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchStartX - touchEndX;
        const diffY = touchStartY - touchEndY;

        // If horizontal swipe is dominant and long enough
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            if (diffX > 0 && pageNum < pdfDoc.numPages) {
                pageNum++;
                queueRenderPage(pageNum);
                viewerContainer.scrollTop = 0;
            } else if (diffX < 0 && pageNum > 1) {
                pageNum--;
                queueRenderPage(pageNum);
                viewerContainer.scrollTop = 0;
            }
        }
        
        // Handle text selection popup
        setTimeout(handleSelection, 100);
    });

    // Autoscroll Feature
    autoscrollBtn.onclick = () => {
        if (autoscrollInterval) {
            stopAutoscroll();
        } else {
            autoscrollBtn.classList.add('active');
            autoscrollInterval = setInterval(() => {
                viewerContainer.scrollTop += 2; // Scroll speed
                
                // Check if reached bottom of page
                if (viewerContainer.scrollTop + viewerContainer.clientHeight >= viewerContainer.scrollHeight - 5) {
                    if (pageNum < pdfDoc.numPages) {
                        pageNum++;
                        queueRenderPage(pageNum);
                        setTimeout(() => { viewerContainer.scrollTop = 0; }, 300);
                    } else {
                        stopAutoscroll();
                    }
                }
            }, 30);
        }
    };

    // Highlighting Toolbar Buttons
    document.querySelectorAll('.hl-btn[data-color]').forEach(btn => {
        btn.onclick = () => saveHighlight(btn.dataset.color);
    });
    document.getElementById('cancel-hl-btn').onclick = () => {
        window.getSelection().removeAllRanges();
        toolbar.classList.add('hidden');
    };
    document.getElementById('add-comment-btn').onclick = () => {
        const comment = prompt("Add a note:");
        if (comment) saveHighlight('yellow', comment);
    };
}

function stopAutoscroll() {
    clearInterval(autoscrollInterval);
    autoscrollInterval = null;
    autoscrollBtn.classList.remove('active');
}

// --- HIGHLIGHTING LOGIC ---
function handleSelection() {
    const selection = window.getSelection();
    if (selection.toString().trim().length > 0) {
        currentSelection = selection;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Position toolbar above selection
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
    
    // Calculate coordinates relative to the page wrapper (crucial for vertical scroll)
    const wrapperRect = pageWrapper.getBoundingClientRect();
    const boxes = [];
    
    for (let i = 0; i < rects.length; i++) {
        boxes.push({
            top: rects[i].top - wrapperRect.top,
            left: rects[i].left - wrapperRect.left,
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
        
        if (hlData.comment) div.title = hlData.comment; 
        
        div.onclick = async () => {
            if (confirm(`Delete highlight?\nText: "${hlData.text}"\nNote: ${hlData.comment || 'None'}`)) {
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
    const response = await fetch('chapters.json');
    const chapters = await response.json();
    const list = document.getElementById('chapter-list');
    
    chapters.forEach(ch => {
        const li = document.createElement('li');
        li.textContent = ch.title;
        li.onclick = () => {
            pageNum = ch.page;
            queueRenderPage(pageNum);
            viewerContainer.scrollTop = 0;
            document.getElementById('sidebar').classList.remove('open');
        };
        list.appendChild(li);
    });
}

// Start
init();
