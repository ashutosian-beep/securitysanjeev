// ============================================
// NETWORK MODULE - Device Communication via Firebase
// ============================================
class DeviceNetwork {
    constructor() {
        this.deviceId = this.getOrCreateDeviceId();
        this.connectedDevices = [];
        this.firebaseUrl = '';
        this.pollingInterval = null;
        this.lastCheckedTimestamp = 0;
        this.onAlertReceived = null;
        this.onDeviceStatusUpdate = null;
    }

    getOrCreateDeviceId() {
        let id = localStorage.getItem('sg_deviceId');
        if (!id) {
            id = 'SG_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
            id = id.toUpperCase();
            localStorage.setItem('sg_deviceId', id);
        }
        return id;
    }

    setFirebaseUrl(url) {
        this.firebaseUrl = url.replace(/\/$/, '');
        localStorage.setItem('sg_firebaseUrl', this.firebaseUrl);
    }

    loadConfig() {
        this.firebaseUrl = localStorage.getItem('sg_firebaseUrl') || '';
        const devices = localStorage.getItem('sg_connectedDevices');
        this.connectedDevices = devices ? JSON.parse(devices) : [];
    }

    addDevice(deviceId, deviceName = '') {
        if (this.connectedDevices.find(d => d.id === deviceId)) {
            return false; // Already exists
        }
        this.connectedDevices.push({
            id: deviceId,
            name: deviceName || deviceId,
            addedAt: Date.now(),
            lastSeen: 0,
            status: 'unknown'
        });
        localStorage.setItem('sg_connectedDevices', JSON.stringify(this.connectedDevices));
        return true;
    }

    removeDevice(deviceId) {
        this.connectedDevices = this.connectedDevices.filter(d => d.id !== deviceId);
        localStorage.setItem('sg_connectedDevices', JSON.stringify(this.connectedDevices));
    }

    getConnectedDevices() {
        return this.connectedDevices;
    }

    // ---- Send Alert to all connected devices ----
    async sendAlert(alertData) {
        if (!this.firebaseUrl || !navigator.onLine) {
            console.log('Cannot send alert: no Firebase URL or offline');
            // Store locally for later
            const pending = JSON.parse(localStorage.getItem('sg_pendingAlerts') || '[]');
            pending.push({ alertData, timestamp: Date.now() });
            localStorage.setItem('sg_pendingAlerts', JSON.stringify(pending));
            return false;
        }

        const alert = {
            fromDevice: this.deviceId,
            type: alertData.type || 'wrong_pattern',
            timestamp: Date.now(),
            datetime: new Date().toLocaleString('hi-IN'),
            gps: alertData.gps || null,
            photos: alertData.photos || [],
            audioUrl: alertData.audioUrl || null,
            message: alertData.message || 'Wrong pattern detected!',
            read: false
        };

        try {
            // Send to each connected device's inbox
            const promises = this.connectedDevices.map(device => {
                return fetch(
                    `${this.firebaseUrl}/alerts/${device.id}/${Date.now()}.json`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(alert)
                    }
                );
            });

            await Promise.allSettled(promises);

            // Also update own status
            await this.updateDeviceStatus('alert_sent');

            console.log('Alert sent to all devices');
            return true;
        } catch (error) {
            console.error('Send alert error:', error);
            return false;
        }
    }

    // ---- Send photo data separately (to avoid Firebase size limits) ----
    async sendPhotoAlert(photoData, alertId) {
        if (!this.firebaseUrl || !navigator.onLine) return false;

        try {
            // Store photo reference (base64 is too large for Firebase)
            // We'll send a small thumbnail + metadata
            const thumbnail = await this.createThumbnail(photoData.image, 200);
            
            const photoAlert = {
                fromDevice: this.deviceId,
                alertId: alertId,
                thumbnail: thumbnail,
                cameraType: photoData.cameraType,
                timestamp: photoData.timestamp,
                datetime: photoData.datetime,
                type: 'photo'
            };

            const promises = this.connectedDevices.map(device => {
                return fetch(
                    `${this.firebaseUrl}/photos/${device.id}/${Date.now()}.json`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(photoAlert)
                    }
                );
            });

            await Promise.allSettled(promises);
            return true;
        } catch (error) {
            console.error('Send photo error:', error);
            return false;
        }
    }

    async createThumbnail(dataUrl, maxSize = 200) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;
                
                if (w > h) {
                    if (w > maxSize) { h *= maxSize / w; w = maxSize; }
                } else {
                    if (h > maxSize) { w *= maxSize / h; h = maxSize; }
                }
                
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.5));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    // ---- GPS Live Update ----
    async sendGPSUpdate(gpsData) {
        if (!this.firebaseUrl || !navigator.onLine) return false;

        try {
            // Update GPS for this device
            await fetch(
                `${this.firebaseUrl}/gps/${this.deviceId}.json`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...gpsData,
                        deviceId: this.deviceId,
                        updatedAt: Date.now()
                    })
                }
            );
            return true;
        } catch (error) {
            console.error('GPS update error:', error);
            return false;
        }
    }

    // ---- Check for incoming alerts ----
    async checkForAlerts() {
        if (!this.firebaseUrl || !navigator.onLine) return [];

        try {
            const response = await fetch(
                `${this.firebaseUrl}/alerts/${this.deviceId}.json`
            );
            
            if (!response.ok) return [];
            
            const data = await response.json();
            if (!data) return [];

            const alerts = Object.entries(data).map(([key, value]) => ({
                ...value,
                firebaseKey: key
            }));

            // Filter new alerts only
            const newAlerts = alerts.filter(a => a.timestamp > this.lastCheckedTimestamp);
            
            if (newAlerts.length > 0) {
                this.lastCheckedTimestamp = Math.max(...newAlerts.map(a => a.timestamp));
            }

            return newAlerts;
        } catch (error) {
            console.error('Check alerts error:', error);
            return [];
        }
    }

    // ---- Check for incoming photos ----
    async checkForPhotos() {
        if (!this.firebaseUrl || !navigator.onLine) return [];

        try {
            const response = await fetch(
                `${this.firebaseUrl}/photos/${this.deviceId}.json`
            );
            
            if (!response.ok) return [];
            
            const data = await response.json();
            if (!data) return [];

            return Object.entries(data).map(([key, value]) => ({
                ...value,
                firebaseKey: key
            }));
        } catch (error) {
            console.error('Check photos error:', error);
            return [];
        }
    }

    // ---- Device Status ----
    async updateDeviceStatus(status = 'online') {
        if (!this.firebaseUrl || !navigator.onLine) return;

        try {
            await fetch(
                `${this.firebaseUrl}/devices/${this.deviceId}.json`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        deviceId: this.deviceId,
                        status: status,
                        lastSeen: Date.now(),
                        datetime: new Date().toLocaleString('hi-IN')
                    })
                }
            );
        } catch (e) {
            console.error('Status update error:', e);
        }
    }

    async checkDeviceStatuses() {
        if (!this.firebaseUrl || !navigator.onLine) return;

        try {
            const response = await fetch(`${this.firebaseUrl}/devices.json`);
            if (!response.ok) return;
            
            const data = await response.json();
            if (!data) return;

            this.connectedDevices.forEach(device => {
                if (data[device.id]) {
                    device.lastSeen = data[device.id].lastSeen;
                    device.status = (Date.now() - device.lastSeen < 60000) ? 'online' : 'offline';
                }
            });

            if (this.onDeviceStatusUpdate) {
                this.onDeviceStatusUpdate(this.connectedDevices);
            }
        } catch (e) {
            console.error('Check device status error:', e);
        }
    }

    // ---- Start Polling ----
    startPolling(intervalMs = 5000, alertCallback) {
        this.onAlertReceived = alertCallback;
        this.lastCheckedTimestamp = Date.now();
        
        // Update own status periodically
        this.updateDeviceStatus('online');

        this.pollingInterval = setInterval(async () => {
            // Check for new alerts
            const newAlerts = await this.checkForAlerts();
            if (newAlerts.length > 0 && this.onAlertReceived) {
                newAlerts.forEach(alert => this.onAlertReceived(alert));
            }

            // Check for new photos
            const newPhotos = await this.checkForPhotos();
            // Photos will be handled by alert callback

            // Update device statuses
            await this.checkDeviceStatuses();
            
            // Update own status
            await this.updateDeviceStatus('online');

            // Process pending alerts
            await this.processPendingAlerts();
        }, intervalMs);

        console.log('Polling started');
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        this.updateDeviceStatus('offline');
        console.log('Polling stopped');
    }

    async processPendingAlerts() {
        if (!navigator.onLine) return;
        
        const pending = JSON.parse(localStorage.getItem('sg_pendingAlerts') || '[]');
        if (pending.length === 0) return;

        for (let item of pending) {
            await this.sendAlert(item.alertData);
        }

        localStorage.setItem('sg_pendingAlerts', '[]');
        console.log('Pending alerts processed');
    }

    // ---- Clear alerts from Firebase ----
    async clearReceivedAlerts() {
        if (!this.firebaseUrl || !navigator.onLine) return;

        try {
            await fetch(
                `${this.firebaseUrl}/alerts/${this.deviceId}.json`,
                { method: 'DELETE' }
            );
        } catch (e) {}
    }
}