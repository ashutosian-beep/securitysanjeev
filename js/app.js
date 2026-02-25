// ============================================
// MAIN APPLICATION - SecureGuard
// ============================================
class SecureGuardApp {
    constructor() {
        this.camera = new SilentCamera();
        this.audio = new SilentAudio();
        this.storage = new StorageManager();
        this.gps = new GPSTracker();
        this.network = new DeviceNetwork();
        
        this.patternSetup = null;
        this.patternLock = null;
        
        this.isLocked = true;
        this.wrongAttempts = 0;
        this.isAlertActive = false;
        this.alertCaptureInterval = null;
        this.settings = {};
        
        this.init();
    }

    async init() {
        // Show splash screen
        await this.sleep(2000);
        
        // Load settings
        this.loadSettings();
        this.network.loadConfig();
        
        // Check if first time
        const savedPattern = this.storage.getSetting('pattern');
        
        if (!savedPattern) {
            // First time - show setup
            this.showScreen('setupScreen');
            this.initSetup();
        } else {
            // Show lock screen
            this.showScreen('lockScreen');
            this.initLockScreen();
        }
        
        // Initialize network polling
        this.startNetworkMonitoring();
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById(screenId);
        if (screen) screen.classList.add('active');
    }

    loadSettings() {
        this.settings = {
            captureInterval: this.storage.getSetting('captureInterval', 10),
            maxAttempts: this.storage.getSetting('maxAttempts', 1),
            audioDuration: this.storage.getSetting('audioDuration', 10),
            enableGps: this.storage.getSetting('enableGps', true),
            silentMode: this.storage.getSetting('silentMode', true)
        };
    }

    // ============================================
    // SETUP
    // ============================================
    initSetup() {
        this.patternSetup = new PatternLock('patternSetupCanvas');
        let tempPattern = '';
        let confirmMode = false;

        const msgEl = document.getElementById('setupPatternMsg');
        const confirmBtn = document.getElementById('confirmPattern');

        this.patternSetup.onPatternComplete = (pattern) => {
            if (pattern.length < 4) {
                msgEl.textContent = 'Pattern too short! Use at least 4 dots.';
                msgEl.className = 'msg error';
                this.patternSetup.showError();
                return;
            }

            if (!confirmMode) {
                tempPattern = pattern;
                confirmMode = true;
                msgEl.textContent = 'Draw pattern again to confirm';
                msgEl.className = 'msg';
                this.patternSetup.showSuccess();
            } else {
                if (pattern === tempPattern) {
                    msgEl.textContent = 'Pattern confirmed! ?';
                    msgEl.className = 'msg success';
                    this.patternSetup.showSuccess();
                    confirmBtn.disabled = false;
                    this.storage.saveSetting('pattern', this.hashPattern(pattern));
                } else {
                    msgEl.textContent = 'Patterns don\'t match! Try again.';
                    msgEl.className = 'msg error';
                    this.patternSetup.showError();
                    confirmMode = false;
                    tempPattern = '';
                }
            }
        };

        confirmBtn.addEventListener('click', () => {
            document.getElementById('step1').classList.add('hidden');
            document.getElementById('step2').classList.remove('hidden');
        });

        // Step 2: Google Drive
        document.getElementById('skipDrive').addEventListener('click', () => {
            document.getElementById('step2').classList.add('hidden');
            document.getElementById('step3').classList.remove('hidden');
            this.initStep3();
        });

        document.getElementById('saveDrive').addEventListener('click', () => {
            const folderId = document.getElementById('driveFolderId').value.trim();
            const apiKey = document.getElementById('googleApiKey').value.trim();
            const oauthToken = document.getElementById('googleOAuthToken').value.trim();

            if (oauthToken) {
                this.storage.saveDriveConfig({
                    folderId,
                    apiKey,
                    oauthToken
                });
                alert('Google Drive configured!');
            }

            document.getElementById('step2').classList.add('hidden');
            document.getElementById('step3').classList.remove('hidden');
            this.initStep3();
        });
    }

    initStep3() {
        // Show device ID
        document.getElementById('myDeviceId').textContent = this.network.deviceId;

        // Firebase URL
        const savedUrl = localStorage.getItem('sg_firebaseUrl');
        if (savedUrl) document.getElementById('firebaseUrl').value = savedUrl;

        // Add device
        document.getElementById('addDeviceBtn').addEventListener('click', () => {
            const deviceId = document.getElementById('addDeviceInput').value.trim();
            if (deviceId) {
                this.network.addDevice(deviceId);
                this.updateDeviceListUI();
                document.getElementById('addDeviceInput').value = '';
            }
        });

        // Finish setup
        document.getElementById('finishSetup').addEventListener('click', () => {
            const firebaseUrl = document.getElementById('firebaseUrl').value.trim();
            if (firebaseUrl) {
                this.network.setFirebaseUrl(firebaseUrl);
            }

            this.storage.saveSetting('setupComplete', true);
            this.showScreen('lockScreen');
            this.initLockScreen();
        });

        this.updateDeviceListUI();
    }

    updateDeviceListUI() {
        const container = document.getElementById('connectedDevicesList');
        if (!container) return;
        
        const devices = this.network.getConnectedDevices();
        
        if (devices.length === 0) {
            container.innerHTML = '<p class="no-alerts">No devices connected</p>';
            return;
        }

        container.innerHTML = devices.map(d => `
            <div class="device-item">
                <span class="device-name">?? ${d.name || d.id}</span>
                <button class="remove-device" onclick="app.removeDevice('${d.id}')">?</button>
            </div>
        `).join('');
    }

    removeDevice(deviceId) {
        this.network.removeDevice(deviceId);
        this.updateDeviceListUI();
        this.updateDashboardDevices();
    }

    // ============================================
    // PATTERN HASHING
    // ============================================
    hashPattern(pattern) {
        // Simple hash for pattern
        let hash = 0;
        const str = 'SG_' + pattern + '_SECURE';
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    // ============================================
    // LOCK SCREEN
    // ============================================
    initLockScreen() {
        this.isLocked = true;
        this.wrongAttempts = 0;
        
        // Update clock
        this.updateLockClock();
        setInterval(() => this.updateLockClock(), 1000);
        
        // Initialize pattern lock
        this.patternLock = new PatternLock('patternLockCanvas');
        
        this.patternLock.onPatternComplete = (pattern) => {
            const savedHash = this.storage.getSetting('pattern');
            const inputHash = this.hashPattern(pattern);
            
            if (inputHash === savedHash) {
                // CORRECT PATTERN
                this.patternLock.showSuccess();
                document.getElementById('lockMsg').textContent = '? Unlocked';
                document.getElementById('lockMsg').className = 'msg success';
                
                // Stop any active alerts
                this.stopAlertCapture();
                
                setTimeout(() => {
                    this.isLocked = false;
                    this.wrongAttempts = 0;
                    this.showScreen('dashboardScreen');
                    this.initDashboard();
                }, 500);
            } else {
                // WRONG PATTERN!
                this.wrongAttempts++;
                this.patternLock.showError();
                document.getElementById('lockMsg').textContent = '? Wrong Pattern!';
                document.getElementById('lockMsg').className = 'msg error';
                document.getElementById('attemptCount').textContent = 
                    `Wrong attempts: ${this.wrongAttempts}`;
                
                // Vibrate
                if (navigator.vibrate) {
                    navigator.vibrate([200, 100, 200]);
                }
                
                // TRIGGER SECURITY ALERT
                if (this.wrongAttempts >= this.settings.maxAttempts) {
                    this.triggerSecurityAlert();
                }
            }
        };
    }

    updateLockClock() {
        const now = new Date();
        const timeEl = document.getElementById('lockTime');
        const dateEl = document.getElementById('lockDate');
        
        if (timeEl) {
            timeEl.textContent = now.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
            });
        }
        
        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString('en-US', { 
                weekday: 'long', 
                month: 'long', 
                day: 'numeric' 
            });
        }
    }

    // ============================================
    // SECURITY ALERT - THE MAIN FEATURE!
    // ============================================
    async triggerSecurityAlert() {
        if (this.isAlertActive) return;
        this.isAlertActive = true;
        
        console.log('?? SECURITY ALERT TRIGGERED! ??');
        
        // 1. Start GPS tracking immediately
        if (this.settings.enableGps) {
            this.gps.startTracking((pos) => {
                this.network.sendGPSUpdate(pos);
            });
        }

        // 2. Start silent camera capture (both cameras)
        this.startAlertCapture();
        
        // 3. Start silent audio recording
        this.startAlertAudioCapture();
        
        // 4. Send alert to connected devices
        this.sendAlertToDevices();
    }

    async startAlertCapture() {
        const intervalSec = this.settings.captureInterval || 10;
        let captureCount = 0;
        
        // Immediate first capture
        await this.performCapture(captureCount++);
        
        // Periodic capture
        this.alertCaptureInterval = setInterval(async () => {
            if (!this.isAlertActive) return;
            await this.performCapture(captureCount++);
        }, intervalSec * 1000);
    }

    async performCapture(count) {
        console.log(`Capture #${count + 1}`);
        
        try {
            // Capture from both cameras
            const photos = await this.camera.captureBothCameras();
            
            for (let photo of photos) {
                // Save locally (works offline too)
                await this.storage.savePhoto(photo);
                
                // Send to connected devices
                if (navigator.onLine) {
                    await this.network.sendPhotoAlert(photo, Date.now());
                }
                
                // Update UI count
                this.updateCaptureCount();
            }
        } catch (error) {
            console.error('Capture error:', error);
        }
    }

    async startAlertAudioCapture() {
        const duration = this.settings.audioDuration || 10;
        const interval = this.settings.captureInterval || 10;
        
        // Immediate first recording
        this.performAudioCapture(duration);
        
        // Periodic audio capture
        this.audioInterval = setInterval(() => {
            if (!this.isAlertActive) return;
            this.performAudioCapture(duration);
        }, interval * 1000);
    }

    async performAudioCapture(duration) {
        try {
            const audioData = await this.audio.startRecording(duration);
            if (audioData) {
                // Save locally
                await this.storage.saveAudio(audioData);
                console.log('Audio captured and saved');
            }
        } catch (error) {
            console.error('Audio capture error:', error);
        }
    }

    async sendAlertToDevices() {
        const gpsData = this.gps.getCurrentPosition();
        
        const alertData = {
            type: 'wrong_pattern',
            message: `?? Wrong pattern detected! Attempt #${this.wrongAttempts}`,
            gps: gpsData,
            wrongAttempts: this.wrongAttempts,
            timestamp: Date.now()
        };

        // Save alert locally
        await this.storage.saveAlert({
            ...alertData,
            direction: 'outgoing',
            datetime: new Date().toLocaleString('hi-IN')
        });

        // Send to connected devices
        await this.network.sendAlert(alertData);
    }

    stopAlertCapture() {
        this.isAlertActive = false;
        
        // Stop camera
        this.camera.stopCapture();
        
        if (this.alertCaptureInterval) {
            clearInterval(this.alertCaptureInterval);
            this.alertCaptureInterval = null;
        }
        
        // Stop audio
        this.audio.stopRecording();
        
        if (this.audioInterval) {
            clearInterval(this.audioInterval);
            this.audioInterval = null;
        }
        
        // GPS keeps running for a bit
        setTimeout(() => {
            this.gps.stopTracking();
        }, 30000);
        
        console.log('Alert capture stopped');
    }

    updateCaptureCount() {
        const el = document.getElementById('capturedPhotos');
        if (el) {
            const current = parseInt(el.textContent) || 0;
            el.textContent = current + 1;
        }
    }

    // ============================================
    // DASHBOARD
    // ============================================
    initDashboard() {
        this.updateDashboardStats();
        this.updateDashboardAlerts();
        this.updateMediaGallery();
        this.updateDashboardDevices();
        this.storage.updateQueueCount();
        
        // Bind buttons
        document.getElementById('lockBtn').onclick = () => {
            this.showScreen('lockScreen');
            this.initLockScreen();
        };
        
        document.getElementById('settingsBtn').onclick = () => {
            this.showScreen('settingsScreen');
            this.initSettings();
        };
        
        document.getElementById('addMoreDevices').onclick = () => {
            document.getElementById('addDeviceModal').classList.remove('hidden');
        };
        
        document.getElementById('cancelAddDevice').onclick = () => {
            document.getElementById('addDeviceModal').classList.add('hidden');
        };
        
        document.getElementById('confirmAddDevice').onclick = () => {
            const id = document.getElementById('newDeviceId').value.trim();
            const name = document.getElementById('newDeviceName').value.trim();
            if (id) {
                this.network.addDevice(id, name);
                this.updateDashboardDevices();
                document.getElementById('addDeviceModal').classList.add('hidden');
                document.getElementById('newDeviceId').value = '';
                document.getElementById('newDeviceName').value = '';
            }
        };
        
        document.getElementById('syncNow').onclick = () => {
            this.storage.processOfflineQueue();
        };
        
        // Refresh dashboard periodically
        this.dashboardRefresh = setInterval(() => {
            this.updateDashboardStats();
            this.updateDashboardAlerts();
            this.updateMediaGallery();
        }, 10000);
    }

    async updateDashboardStats() {
        try {
            const alerts = await this.storage.getAlerts();
            const photos = await this.storage.getPhotos();
            const devices = this.network.getConnectedDevices();
            
            document.getElementById('totalAlerts').textContent = alerts.length;
            document.getElementById('connectedDevices').textContent = devices.length;
            document.getElementById('capturedPhotos').textContent = photos.length;
        } catch (e) {}
    }

    async updateDashboardAlerts() {
        try {
            const alerts = await this.storage.getAlerts(20);
            const container = document.getElementById('alertsContainer');
            
            if (alerts.length === 0) {
                container.innerHTML = '<p class="no-alerts">No alerts yet. Device is secure.</p>';
                return;
            }
            
            container.innerHTML = alerts.map(alert => `
                <div class="alert-item ${alert.direction === 'incoming' ? 'alert-flash' : ''}">
                    <span class="alert-icon">${alert.direction === 'incoming' ? '??' : '??'}</span>
                    <div class="alert-info">
                        <h4>${alert.message || 'Security Alert'}</h4>
                        <p>${alert.direction === 'incoming' ? 'From: ' + (alert.fromDevice || 'Unknown') : 'Local Alert'}</p>
                        ${alert.gps ? `<p>?? ${alert.gps.latitude?.toFixed(4)}, ${alert.gps.longitude?.toFixed(4)}</p>` : ''}
                    </div>
                    <span class="alert-time">${alert.datetime || new Date(alert.timestamp).toLocaleTimeString()}</span>
                </div>
            `).join('');
        } catch (e) {}
    }

    async updateMediaGallery() {
        try {
            const photos = await this.storage.getPhotos(30);
            const container = document.getElementById('mediaGallery');
            
            if (photos.length === 0) {
                container.innerHTML = '<p class="no-alerts">No captured media yet.</p>';
                return;
            }
            
            container.innerHTML = photos.map((photo, i) => `
                <div class="media-item" onclick="app.viewImage('${i}')">
                    <img src="${photo.image}" alt="Capture ${i+1}" loading="lazy">
                    <span class="media-type">${photo.datetime || ''}</span>
                    <span class="media-camera">${photo.cameraType || photo.facing || ''}</span>
                </div>
            `).join('');
            
            // Store reference for viewing
            this._galleryPhotos = photos;
        } catch (e) {}
    }

    viewImage(index) {
        if (!this._galleryPhotos || !this._galleryPhotos[index]) return;
        
        const viewer = document.createElement('div');
        viewer.className = 'image-viewer';
        viewer.innerHTML = `<img src="${this._galleryPhotos[index].image}" alt="Photo">`;
        viewer.onclick = () => viewer.remove();
        document.body.appendChild(viewer);
    }

    updateDashboardDevices() {
        const container = document.getElementById('devicesStatus');
        if (!container) return;
        
        const devices = this.network.getConnectedDevices();
        
        if (devices.length === 0) {
            container.innerHTML = '<p class="no-alerts">No devices connected</p>';
            return;
        }
        
        container.innerHTML = devices.map(d => `
            <div class="device-item">
                <span class="device-name">?? ${d.name || d.id}</span>
                <span class="device-status ${d.status === 'online' ? 'online' : 'offline'}">
                    ${d.status === 'online' ? '? Online' : '? Offline'}
                </span>
                <button class="remove-device" onclick="app.removeDevice('${d.id}')">?</button>
            </div>
        `).join('');
    }

    // ============================================
    // SETTINGS
    // ============================================
    initSettings() {
        document.getElementById('captureInterval').value = this.settings.captureInterval;
        document.getElementById('maxAttempts').value = this.settings.maxAttempts;
        document.getElementById('audioDuration').value = this.settings.audioDuration;
        document.getElementById('enableGps').checked = this.settings.enableGps;
        document.getElementById('silentMode').checked = this.settings.silentMode;
        
        document.getElementById('backFromSettings').onclick = () => {
            this.showScreen('dashboardScreen');
        };
        
        document.getElementById('saveSettings').onclick = () => {
            this.settings.captureInterval = parseInt(document.getElementById('captureInterval').value) || 10;
            this.settings.maxAttempts = parseInt(document.getElementById('maxAttempts').value) || 1;
            this.settings.audioDuration = parseInt(document.getElementById('audioDuration').value) || 10;
            this.settings.enableGps = document.getElementById('enableGps').checked;
            this.settings.silentMode = document.getElementById('silentMode').checked;
            
            this.storage.saveSetting('captureInterval', this.settings.captureInterval);
            this.storage.saveSetting('maxAttempts', this.settings.maxAttempts);
            this.storage.saveSetting('audioDuration', this.settings.audioDuration);
            this.storage.saveSetting('enableGps', this.settings.enableGps);
            this.storage.saveSetting('silentMode', this.settings.silentMode);
            
            alert('Settings saved!');
            this.showScreen('dashboardScreen');
        };
        
        document.getElementById('changePatternBtn').onclick = () => {
            if (confirm('Are you sure you want to change the pattern?')) {
                this.storage.removeSetting('pattern');
                this.showScreen('setupScreen');
                document.getElementById('step1').classList.remove('hidden');
                document.getElementById('step2').classList.add('hidden');
                document.getElementById('step3').classList.add('hidden');
                this.initSetup();
            }
        };
        
        document.getElementById('resetApp').onclick = async () => {
            if (confirm('This will delete ALL data. Are you sure?')) {
                if (confirm('REALLY sure? All photos, settings, and connections will be lost!')) {
                    await this.storage.resetAll();
                    location.reload();
                }
            }
        };
    }

    // ============================================
    // NETWORK MONITORING
    // ============================================
    startNetworkMonitoring() {
        this.network.startPolling(5000, (alert) => {
            this.handleIncomingAlert(alert);
        });
    }

    async handleIncomingAlert(alert) {
        console.log('?? Incoming alert:', alert);
        
        // Play alert sound
        this.playAlertSound();
        
        // Vibrate
        if (navigator.vibrate) {
            navigator.vibrate([500, 200, 500, 200, 500]);
        }
        
        // Save to local DB
        await this.storage.saveAlert({
            ...alert,
            direction: 'incoming',
            receivedAt: Date.now()
        });
        
        // Update UI if on dashboard
        this.updateDashboardAlerts();
        
        // Show notification
        this.showNotification(alert);
        
        // Update received alerts section
        this.updateReceivedAlerts(alert);
    }

    playAlertSound() {
        try {
            // Create alert tone programmatically
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            // Alert pattern: beep-beep-beep
            const playBeep = (startTime, freq, duration) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.value = 0.3;
                
                osc.start(startTime);
                osc.stop(startTime + duration);
            };
            
            const now = audioCtx.currentTime;
            playBeep(now, 880, 0.2);
            playBeep(now + 0.3, 880, 0.2);
            playBeep(now + 0.6, 1100, 0.4);
            playBeep(now + 1.2, 880, 0.2);
            playBeep(now + 1.5, 880, 0.2);
            playBeep(now + 1.8, 1100, 0.4);
        } catch (e) {
            console.error('Alert sound error:', e);
            // Fallback
            const audio = document.getElementById('alertSound');
            if (audio) audio.play().catch(() => {});
        }
    }

    showNotification(alert) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('?? SecureGuard Alert!', {
                body: alert.message || 'Wrong pattern detected on connected device!',
                icon: '???',
                vibrate: [200, 100, 200],
                requireInteraction: true
            });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then(perm => {
                if (perm === 'granted') {
                    this.showNotification(alert);
                }
            });
        }
    }

    updateReceivedAlerts(alert) {
        const container = document.getElementById('receivedAlerts');
        if (!container) return;
        
        // Remove "no alerts" message
        const noAlerts = container.querySelector('.no-alerts');
        if (noAlerts) noAlerts.remove();
        
        const alertEl = document.createElement('div');
        alertEl.className = 'alert-item alert-flash';
        alertEl.innerHTML = `
            <span class="alert-icon">??</span>
            <div class="alert-info">
                <h4>${alert.message || 'Security Alert'}</h4>
                <p>From: ${alert.fromDevice || 'Unknown Device'}</p>
                ${alert.gps ? `<p>?? <a href="https://www.google.com/maps?q=${alert.gps.latitude},${alert.gps.longitude}" target="_blank">View Location</a></p>` : ''}
            </div>
            <span class="alert-time">${alert.datetime || new Date().toLocaleTimeString()}</span>
        `;
        
        container.insertBefore(alertEl, container.firstChild);
        
        // Show audio indicator
        if (alert.audioUrl) {
            const audioIndicator = document.createElement('div');
            audioIndicator.className = 'audio-indicator';
            audioIndicator.innerHTML = `
                <div class="audio-bars">
                    <div class="audio-bar"></div>
                    <div class="audio-bar"></div>
                    <div class="audio-bar"></div>
                    <div class="audio-bar"></div>
                </div>
                <span>Live Audio</span>
            `;
            alertEl.querySelector('.alert-info').appendChild(audioIndicator);
        }
    }

    // ============================================
    // PERMISSIONS
    // ============================================
    async requestPermissions() {
        // Camera
        try {
            await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (e) {
            console.warn('Camera permission denied');
        }

        // Microphone
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.warn('Microphone permission denied');
        }

        // Notification
        if ('Notification' in window) {
            await Notification.requestPermission();
        }

        // Geolocation
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(() => {}, () => {});
        }
    }
}

// ============================================
// INITIALIZE APP
// ============================================
let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new SecureGuardApp();
    
    // Request permissions on first interaction
    document.body.addEventListener('click', function requestPerms() {
        app.requestPermissions();
        document.body.removeEventListener('click', requestPerms);
    }, { once: true });
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
        console.log('SW registration failed:', err);
    });
}

// Prevent back button from closing app
window.addEventListener('popstate', (e) => {
    e.preventDefault();
    if (app && !app.isLocked) {
        app.showScreen('lockScreen');
        app.initLockScreen();
    }
});

// Handle visibility change (app going to background)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && app && !app.isLocked) {
        // App went to background - auto lock after delay
        setTimeout(() => {
            if (document.hidden && app) {
                app.isLocked = true;
            }
        }, 30000); // 30 seconds
    }
});
