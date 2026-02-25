// ============================================
// PATTERN LOCK MODULE
// ============================================
class PatternLock {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.dots = [];
        this.selectedDots = [];
        this.pattern = [];
        this.isDrawing = false;
        this.currentPos = { x: 0, y: 0 };
        
        this.options = {
            rows: 3,
            cols: 3,
            dotRadius: 12,
            dotColor: '#8892b0',
            selectedDotColor: '#00d4ff',
            errorDotColor: '#ff4444',
            lineColor: '#00d4ff',
            errorLineColor: '#ff4444',
            lineWidth: 3,
            ...options
        };

        this.onPatternComplete = null;
        this.isError = false;
        
        this.initDots();
        this.bindEvents();
        this.draw();
    }

    initDots() {
        this.dots = [];
        const padding = 50;
        const cellW = (this.canvas.width - padding * 2) / (this.options.cols - 1);
        const cellH = (this.canvas.height - padding * 2) / (this.options.rows - 1);

        for (let r = 0; r < this.options.rows; r++) {
            for (let c = 0; c < this.options.cols; c++) {
                this.dots.push({
                    x: padding + c * cellW,
                    y: padding + r * cellH,
                    index: r * this.options.cols + c,
                    selected: false
                });
            }
        }
    }

    bindEvents() {
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.handleStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleEnd(e), { passive: false });
        
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleStart(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleEnd(e));
    }

    getPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        if (e.touches) {
            return {
                x: (e.touches[0].clientX - rect.left) * scaleX,
                y: (e.touches[0].clientY - rect.top) * scaleY
            };
        }
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    handleStart(e) {
        e.preventDefault();
        this.isDrawing = true;
        this.isError = false;
        this.selectedDots = [];
        this.pattern = [];
        this.dots.forEach(d => d.selected = false);
        
        const pos = this.getPosition(e);
        this.checkDot(pos);
        this.currentPos = pos;
        this.draw();
    }

    handleMove(e) {
        e.preventDefault();
        if (!this.isDrawing) return;
        
        const pos = this.getPosition(e);
        this.currentPos = pos;
        this.checkDot(pos);
        this.checkIntermediateDots();
        this.draw();
    }

    handleEnd(e) {
        e.preventDefault();
        if (!this.isDrawing) return;
        this.isDrawing = false;
        
        if (this.pattern.length > 0 && this.onPatternComplete) {
            this.onPatternComplete(this.pattern.join(''));
        }
        
        this.draw();
    }

    checkDot(pos) {
        for (let dot of this.dots) {
            if (dot.selected) continue;
            const dist = Math.sqrt(
                Math.pow(pos.x - dot.x, 2) + Math.pow(pos.y - dot.y, 2)
            );
            if (dist < this.options.dotRadius * 2.5) {
                dot.selected = true;
                this.selectedDots.push(dot);
                this.pattern.push(dot.index);
                
                // Vibrate if available
                if (navigator.vibrate) {
                    navigator.vibrate(30);
                }
            }
        }
    }

    checkIntermediateDots() {
        if (this.selectedDots.length < 1) return;
        
        const lastDot = this.selectedDots[this.selectedDots.length - 1];
        
        for (let dot of this.dots) {
            if (dot.selected) continue;
            
            // Check if dot is between last selected and current position
            const d1 = Math.sqrt(Math.pow(lastDot.x - dot.x, 2) + Math.pow(lastDot.y - dot.y, 2));
            const d2 = Math.sqrt(Math.pow(this.currentPos.x - dot.x, 2) + Math.pow(this.currentPos.y - dot.y, 2));
            const d3 = Math.sqrt(Math.pow(lastDot.x - this.currentPos.x, 2) + Math.pow(lastDot.y - this.currentPos.y, 2));
            
            if (Math.abs(d1 + d2 - d3) < 15) {
                dot.selected = true;
                this.selectedDots.push(dot);
                this.pattern.push(dot.index);
            }
        }
    }

    showError() {
        this.isError = true;
        this.draw();
        
        setTimeout(() => {
            this.reset();
        }, 1000);
    }

    showSuccess() {
        this.isError = false;
        this.draw();
        setTimeout(() => {
            this.reset();
        }, 500);
    }

    reset() {
        this.selectedDots = [];
        this.pattern = [];
        this.isError = false;
        this.isDrawing = false;
        this.dots.forEach(d => d.selected = false);
        this.draw();
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        const lineColor = this.isError ? this.options.errorLineColor : this.options.lineColor;
        const dotSelectedColor = this.isError ? this.options.errorDotColor : this.options.selectedDotColor;
        
        // Draw lines between selected dots
        if (this.selectedDots.length > 1) {
            this.ctx.beginPath();
            this.ctx.strokeStyle = lineColor;
            this.ctx.lineWidth = this.options.lineWidth;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            
            this.ctx.moveTo(this.selectedDots[0].x, this.selectedDots[0].y);
            for (let i = 1; i < this.selectedDots.length; i++) {
                this.ctx.lineTo(this.selectedDots[i].x, this.selectedDots[i].y);
            }
            
            this.ctx.stroke();
        }

        // Draw line to current position while drawing
        if (this.isDrawing && this.selectedDots.length > 0) {
            const last = this.selectedDots[this.selectedDots.length - 1];
            this.ctx.beginPath();
            this.ctx.strokeStyle = lineColor;
            this.ctx.lineWidth = this.options.lineWidth;
            this.ctx.globalAlpha = 0.5;
            this.ctx.moveTo(last.x, last.y);
            this.ctx.lineTo(this.currentPos.x, this.currentPos.y);
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
        }

        // Draw dots
        for (let dot of this.dots) {
            // Outer ring
            this.ctx.beginPath();
            this.ctx.arc(dot.x, dot.y, this.options.dotRadius + 8, 0, Math.PI * 2);
            this.ctx.strokeStyle = dot.selected ? dotSelectedColor : 'rgba(136, 146, 176, 0.3)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            
            // Inner dot
            this.ctx.beginPath();
            this.ctx.arc(dot.x, dot.y, this.options.dotRadius, 0, Math.PI * 2);
            if (dot.selected) {
                this.ctx.fillStyle = dotSelectedColor;
                this.ctx.shadowColor = dotSelectedColor;
                this.ctx.shadowBlur = 15;
            } else {
                this.ctx.fillStyle = this.options.dotColor;
                this.ctx.shadowBlur = 0;
            }
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
            
            // Center highlight
            if (dot.selected) {
                this.ctx.beginPath();
                this.ctx.arc(dot.x, dot.y, 4, 0, Math.PI * 2);
                this.ctx.fillStyle = '#ffffff';
                this.ctx.fill();
            }
        }
    }

    getPattern() {
        return this.pattern.join('');
    }

    setSize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.initDots();
        this.draw();
    }
}
