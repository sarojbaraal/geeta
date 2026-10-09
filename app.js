pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// State
let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let currentSelection = null;
let autoscrollInterval = null;
let zoomMultiplier = 1.0; 
let baseScale = 1.0;

// Pinch Zoom State
let initialPinchDistance = 0;
let initialZoom = 1.0;
let lastPinchZoom = 1.0;

// Tap State
let touchStartTime = 0;
let touchStartPos = {x: 0, y: 0};

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
const rightTrigger = document.getElementById('right-edge-trigger');
const edgePanel = document.getElementById('edge-chapter-panel');

async function init() {
    const loadingTask = pdfjsLib.getDocument('book.pdf');
    pdfDoc = await loadingTask.promise;
    document.getElementById('page-jump').max = pdfDoc.numPages;
    
    loadChapters();
    queueRenderPage(pageNum);
    setupEventListeners();
}

function renderPage(num) {
    pageRendering = true;
    pageIndicator.textContent = `Page ${num} / ${pdfDoc.numPages}`;
    pageWrapper.classList.add('turning');
    pageWrapper.style.transform = ''; 

    pdfDoc.getPage(num).then(async (page) => {
        const viewport = page.getViewport({ scale: 1 });
        const containerWidth = viewerContainer.clientWidth - 20; 
        baseScale = containerWidth / viewport.width;
        const finalScale = baseScale * zoomMultiplier;
        const scaledViewport = page.getViewport({ scale: finalScale });

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(scaledViewport.width * outputScale);
        canvas.height = Math.floor(scaledViewport.height * outputScale);
        canvas.style.width = Math.floor(scaledViewport.width) + 'px';
        canvas.style.height = Math.floor(scaledViewport.height) + 'px';
        
        // Because of content-box, this sets the inner size, and padding adds to the outside
        pageWrapper.style.width = Math.floor(scaledViewport.width) + 'px';
        pageWrapper.style.height = Math.floor(scaledViewport.height) + 'px';

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
        const renderContext = { canvasContext: ctx, viewport: scaledViewport, transform: transform };
        const renderTask = page.render(renderContext);

        textLayerDiv.style.width = Math.floor(scaledViewport.width) + 'px';
        textLayerDiv.style.height = Math.floor(scaledViewport.height) + 'px';
        highlightLayerDiv.style.width = Math.floor(scaledViewport.width) + 'px';
        highlightLayerDiv.style.height = Math.floor(scaledViewport.height) + 'px';

        const textContent = await page.getTextContent();
        textLayerDiv.innerHTML = ''; 
        await pdfjsLib.renderTextLayer({
            textContent: textContent, container: textLayerDiv, viewport: scaledViewport, textDivs: []
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
    if (pageRendering) pageNumPending = num;
    else renderPage(num);
}

function setupEventListeners() {
    // Page Jump
    document.getElementById('page-jump').onchange = (e) => {
        const val = parseInt(e.target.value);
        if (val >= 1 && val <= pdfDoc.numPages) { 
            pageNum = val; queueRenderPage(pageNum); 
            viewerContainer.scrollTop = 0; viewerContainer.scrollLeft = 0;
        }
    };

    // Zoom Buttons
    document.getElementById('zoom-in').onclick = () => {
        if (zoomMultiplier < 3.0) { zoomMultiplier += 0.5; queueRenderPage(pageNum); viewerContainer.scrollTop = 0; viewerContainer.scrollLeft = 0; }
    };
    document.getElementById('zoom-out').onclick = () => {
        if (zoomMultiplier > 1.0) { zoomMultiplier -= 0.5; queueRenderPage(pageNum); viewerContainer.scrollTop = 0; viewerContainer.scrollLeft = 0; }
    };

    // Sidebars
    document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.add('open');
    document.getElementById('close-sidebar').onclick = () => document.getElementById('sidebar').classList.remove('open');
    
    // Right Edge Panel
    rightTrigger.addEventListener('touchstart', () => edgePanel.classList.add('open'));
    document.getElementById('close-edge-panel').onclick = () => edgePanel.classList.remove('open');
    document.addEventListener('touchstart', (e) => {
        if (!edgePanel.contains(e.target) && !rightTrigger.contains(e.target)) {
            edgePanel.classList.remove('open');
        }
    });

    // Touch Events (Tap, Swipe, Pinch)
    viewerContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStartTime = Date.now();
            touchStartPos = {x: e.touches[0].clientX, y: e.touches[0].clientY};
        }
        if (e.touches.length === 2) {
            initialPinchDistance = getDistance(e.touches[0], e.touches[1]);
            initialZoom = zoomMultiplier;
        }
    }, { passive: false });

    viewerContainer.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDistance > 0) {
            e.preventDefault(); 
            const currentDistance = getDistance(e.touches[0], e.touches[1]);
            const ratio = currentDistance / initialPinchDistance;
            lastPinchZoom = Math.max(1.0, Math.min(3.0, initialZoom * ratio));
            
            pageWrapper.style.transform = `scale(${lastPinchZoom / zoomMultiplier})`;
            pageWrapper.style.transformOrigin = '0 0'; 
        }
    }, { passive: false });

    viewerContainer.addEventListener('touchend', (e) => {
        if (e.touches.length < 2 && initialPinchDistance > 0) {
            pageWrapper.style.transform = ''; 
            if (Math.abs(lastPinchZoom - zoomMultiplier) > 0.05) {
                zoomMultiplier = lastPinchZoom;
                queueRenderPage(pageNum);
            }
            initialPinchDistance = 0;
        }

        // Tap to Turn Pages
        const duration = Date.now() - touchStartTime;
        const touchEndPos = {x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY};
        const distX = Math.abs(touchEndPos.x - touchStartPos.x);
        const distY = Math.abs(touchEndPos.y - touchStartPos.y);
        
        if (duration < 300 && distX < 15 && distY < 15) {
            const rect = viewerContainer.getBoundingClientRect();
            const x = touchStartPos.x - rect.left;
            const width = rect.width;
            
            if (x < width * 0.3 && pageNum > 1) {
                pageNum--; queueRenderPage(pageNum); viewerContainer.scrollTop = 0;
            } else if (x > width * 0.7 && pageNum < pdfDoc.numPages) {
                pageNum++; queueRenderPage(pageNum); viewerContainer.scrollTop = 0;
            }
        }
        
        setTimeout(handleSelection, 100);
    });

    // Autoscroll
    autoscrollBtn.onclick = () => {
        if (autoscrollInterval) {
            stopAutoscroll();
        } else {
            autoscrollBtn.classList.add('active');
            autoscrollInterval = setInterval(() => {
                viewerContainer.scrollTop += 2;
                if (viewerContainer.scrollTop + viewerContainer.clientHeight >= viewerContainer.scrollHeight - 5) {
                    if (pageNum < pdfDoc.numPages) {
                        pageNum++; queueRenderPage(pageNum);
                        setTimeout(() => { viewerContainer.scrollTop = 0; }, 300);
                    } else { stopAutoscroll(); }
                }
            }, 30);
        }
    };

    // Highlight Toolbar
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

function getDistance(t1, t2) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

// --- HIGHLIGHTING LOGIC ---
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
        if (!toolbar.matches(':hover')) toolbar.classList.add('hidden');
    }
}

async function saveHighlight(color, comment = '') {
    if (!currentSelection) return;
    const range = currentSelection.getRangeAt(0);
    const rects = range.getClientRects();
    const text = currentSelection.toString().trim();
    
    // FIX: Use canvas bounding rect instead of wrapper to perfectly align with the 3mm offset
    const canvasRect = canvas.getBoundingClientRect();
    const boxes = [];
    
    for (let i = 0; i < rects.length; i++) {
        boxes.push({
            top: rects[i].top - canvasRect.top,
            left: rects[i].left - canvasRect.left,
            width: rects[i].width,
            height: rects[i].height
        });
    }
    
    const highlightData = { id: Date.now(), page: pageNum, text, comment, color, boxes };
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
    const pageHighlights = await localForage.getItem(`highlights_page_${page}`) || [];
    pageHighlights.forEach(hl => drawHighlight(hl));
}

function drawHighlight(hlData) {
    hlData.boxes.forEach(box => {
        const div = document.createElement('div');
        div.className = `highlight-box ${hlData.color}`;
        div.style.top = box.top + 'px'; div.style.left = box.left + 'px';
        div.style.width = box.width + 'px'; div.style.height = box.height + 'px';
        if (hlData.comment) div.title = hlData.comment; 
        div.onclick = async () => {
            if (confirm(`Delete highlight?\nText: "${hlData.text}"\nNote: ${hlData.comment || 'None'}`)) {
                const key = `highlights_page_${pageNum}`;
                let p = await localForage.getItem(key) || [];
                p = p.filter(h => h.id !== hlData.id);
                await localForage.setItem(key, p);
                div.remove();
            }
        };
        highlightLayerDiv.appendChild(div);
    });
}

// --- CHAPTERS ---
async function loadChapters() {
    const response = await fetch('chapters.json');
    const chapters = await response.json();
    
    const leftList = document.getElementById('chapter-list');
    const rightList = document.getElementById('edge-chapter-list');
    
    chapters.forEach(ch => {
        const li1 = document.createElement('li');
        li1.textContent = ch.title;
        li1.onclick = () => jumpToChapter(ch.page);
        leftList.appendChild(li1);
        
        const li2 = document.createElement('li');
        li2.textContent = ch.title;
        li2.onclick = () => {
            jumpToChapter(ch.page);
            edgePanel.classList.remove('open');
        };
        rightList.appendChild(li2);
    });
}

function jumpToChapter(page) {
    pageNum = page;
    queueRenderPage(pageNum);
    viewerContainer.scrollTop = 0;
    viewerContainer.scrollLeft = 0;
    document.getElementById('sidebar').classList.remove('open');
}

init();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then((reg) => console.log('Service Worker registered:', reg.scope))
            .catch((err) => console.log('Service Worker registration failed:', err));
    });
}
