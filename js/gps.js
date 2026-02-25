// ============================================
// GPS MODULE - Location Tracking
// ============================================
class GPSTracker {
    constructor() {
        this.watchId = null;
        this.currentPosition = null;
        this.positionHistory = [];
        this.isTracking = false;
        this.onPositionUpdate = null;
    }

    startTracking(callback) {
        if (!navigator.geolocation) {
            console.error('Geolocation not supported');
            return false;
        }

        this.onPositionUpdate = callback;
        this.isTracking = true;

        // Get initial position
        navigator.geolocation.getCurrentPosition(
            (pos) => this.handlePosition(pos),
            (err) => console.error('GPS error:', err),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );

        // Watch position continuously
        this.watchId = navigator.geolocation.watchPosition(
            (pos) => this.handlePosition(pos),
            (err) => console.error('GPS watch error:', err),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
        );

        console.log('GPS tracking started');
        return true;
    }

    handlePosition(position) {
        const posData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: Date.now(),
            datetime: new Date().toLocaleString('hi-IN')
        };

        this.currentPosition = posData;
        this.positionHistory.push(posData);

        // Keep only last 100 positions
        if (this.positionHistory.length > 100) {
            this.positionHistory = this.positionHistory.slice(-100);
        }

        // Update UI
        this.updateUI(posData);

        // Callback
        if (this.onPositionUpdate) {
            this.onPositionUpdate(posData);
        }
    }

    updateUI(posData) {
        const latEl = document.getElementById('gpsLat');
        const lngEl = document.getElementById('gpsLng');
        const accEl = document.getElementById('gpsAcc');
        const timeEl = document.getElementById('gpsTime');
        const mapLink = document.getElementById('gpsMapLink');

        if (latEl) latEl.textContent = posData.latitude.toFixed(6);
        if (lngEl) lngEl.textContent = posData.longitude.toFixed(6);
        if (accEl) accEl.textContent = Math.round(posData.accuracy);
        if (timeEl) timeEl.textContent = posData.datetime;
        if (mapLink) {
            mapLink.href = `https://www.google.com/maps?q=${posData.latitude},${posData.longitude}`;
        }
    }

    stopTracking() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        this.isTracking = false;
        console.log('GPS tracking stopped');
    }

    getCurrentPosition() {
        return this.currentPosition;
    }

    getPositionHistory() {
        return this.positionHistory;
    }

    getGoogleMapsLink() {
        if (!this.currentPosition) return '#';
        return `https://www.google.com/maps?q=${this.currentPosition.latitude},${this.currentPosition.longitude}`;
    }
}