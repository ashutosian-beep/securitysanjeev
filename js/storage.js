// ============================================
// STORAGE MODULE - Local + Google Drive
// ============================================
class StorageManager {
    constructor() {
        this.dbName = 'SecureGuardDB';
        this.dbVersion = 1;
        this.db = null;
        this.driveConfig = null;
        this.offlineQueue = [];
        this.isOnline = navigator.onLine;
        
        this.initDB();
        this.loadDriveConfig();
        this.setupNetworkListeners();
    }

    // ---- IndexedDB ----
    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                
                if (!db.objectStoreNames.contains('photos')) {
                    const photoStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
                    photoStore.createIndex('timestamp', 'timestamp', { unique: false });
                    photoStore.createIndex('synced', 'synced', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('audio')) {
                    const audioStore = db.createObjectStore('audio', { keyPath: 'id', autoIncrement: true });
                    audioStore.createIndex('timestamp', 'timestamp', { unique: false });
                    audioStore.createIndex('synced', 'synced', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('alerts')) {
                    const alertStore = db.createObjectStore('alerts', { keyPath: 'id', autoIncrement: true });
                    alertStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('offlineQueue')) {
                    db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
                }
                
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                console.log('IndexedDB initialized');
                resolve(this.db);
            };

            request.onerror = (e) => {
                console.error('IndexedDB error:', e);
                reject(e);
            };
        });
    }

    async saveToStore(storeName, data) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('DB not initialized');
                return;
            }
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.add(data);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e);
        });
    }

    async getFromStore(storeName, limit = 50) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('DB not initialized');
                return;
            }
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => {
                let results = request.result || [];
                // Sort by timestamp descending
                results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                resolve(results.slice(0, limit));
            };
            request.onerror = (e) => reject(e);
        });
    }

    async getUnsyncedItems(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('DB not initialized');
                return;
            }
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index('synced');
            const request = index.getAll(false);
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e) => reject(e);
        });
    }

    async markAsSynced(storeName, id) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('DB not initialized');
                return;
            }
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const getReq = store.get(id);
            
            getReq.onsuccess = () => {
                const data = getReq.result;
                if (data) {
                    data.synced = true;
                    store.put(data);
                }
                resolve();
            };
            getReq.onerror = (e) => reject(e);
        });
    }

    async clearStore(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('DB not initialized');
                return;
            }
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    }

    // ---- Local Storage Settings ----
    saveSetting(key, value) {
        try {
            localStorage.setItem(`sg_${key}`, JSON.stringify(value));
        } catch (e) {
            console.error('LocalStorage save error:', e);
        }
    }

    getSetting(key, defaultValue = null) {
        try {
            const val = localStorage.getItem(`sg_${key}`);
            return val ? JSON.parse(val) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    }

    removeSetting(key) {
        localStorage.removeItem(`sg_${key}`);
    }

    // ---- Google Drive ----
    loadDriveConfig() {
        this.driveConfig = this.getSetting('driveConfig', null);
    }

    saveDriveConfig(config) {
        this.driveConfig = config;
        this.saveSetting('driveConfig', config);
    }

    async uploadToDrive(fileData, fileName, mimeType = 'image/jpeg') {
        if (!this.driveConfig || !this.driveConfig.oauthToken) {
            console.log('Google Drive not configured, saving to offline queue');
            await this.addToOfflineQueue({
                type: 'drive_upload',
                fileData,
                fileName,
                mimeType,
                timestamp: Date.now()
            });
            return false;
        }

        try {
            const metadata = {
                name: fileName,
                parents: this.driveConfig.folderId ? [this.driveConfig.folderId] : []
            };

            // Convert data URL to blob
            let blob;
            if (fileData.startsWith('data:')) {
                const response = await fetch(fileData);
                blob = await response.blob();
            } else {
                blob = new Blob([fileData], { type: mimeType });
            }

            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', blob);

            const response = await fetch(
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.driveConfig.oauthToken}`
                    },
                    body: form
                }
            );

            if (response.ok) {
                const result = await response.json();
                console.log(`Uploaded to Drive: ${fileName}`, result.id);
                return result;
            } else {
                const errText = await response.text();
                console.error('Drive upload error:', errText);
                // Add to offline queue for retry
                await this.addToOfflineQueue({
                    type: 'drive_upload',
                    fileData,
                    fileName,
                    mimeType,
                    timestamp: Date.now()
                });
                return false;
            }
        } catch (error) {
            console.error('Drive upload exception:', error);
            await this.addToOfflineQueue({
                type: 'drive_upload',
                fileData,
                fileName,
                mimeType,
                timestamp: Date.now()
            });
            return false;
        }
    }

    // ---- Offline Queue ----
    async addToOfflineQueue(item) {
        try {
            await this.saveToStore('offlineQueue', item);
            this.updateQueueCount();
        } catch (e) {
            // Fallback to localStorage
            const queue = this.getSetting('offlineQueue', []);
            queue.push(item);
            this.saveSetting('offlineQueue', queue);
        }
    }

    async processOfflineQueue() {
        if (!navigator.onLine) return;

        try {
            const items = await this.getFromStore('offlineQueue');
            
            for (let item of items) {
                if (item.type === 'drive_upload') {
                    const success = await this.uploadToDrive(
                        item.fileData,
                        item.fileName,
                        item.mimeType
                    );
                    if (success) {
                        // Remove from queue
                        const tx = this.db.transaction('offlineQueue', 'readwrite');
                        tx.objectStore('offlineQueue').delete(item.id);
                    }
                }
            }

            this.updateQueueCount();
            console.log('Offline queue processed');
        } catch (e) {
            console.error('Queue processing error:', e);
        }
    }

    async getQueueCount() {
        try {
            const items = await this.getFromStore('offlineQueue');
            return items.length;
        } catch (e) {
            const queue = this.getSetting('offlineQueue', []);
            return queue.length;
        }
    }

    updateQueueCount() {
        this.getQueueCount().then(count => {
            const el = document.getElementById('queueCount');
            if (el) el.textContent = count;
        });
    }

    // ---- Network Listeners ----
    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            console.log('Network: Online - processing queue...');
            this.processOfflineQueue();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            console.log('Network: Offline');
        });
    }

    // ---- Save Captured Data ----
    async savePhoto(photoData) {
        const data = {
            ...photoData,
            synced: false,
            savedAt: Date.now()
        };
        
        // Save to IndexedDB
        try {
            const id = await this.saveToStore('photos', data);
            
            // Try to upload to Drive
            if (navigator.onLine) {
                const fileName = `SG_Photo_${photoData.cameraType || 'Unknown'}_${Date.now()}.jpg`;
                const uploaded = await this.uploadToDrive(photoData.image, fileName, 'image/jpeg');
                if (uploaded) {
                    await this.markAsSynced('photos', id);
                }
            }
            
            return id;
        } catch (e) {
            console.error('Save photo error:', e);
            return null;
        }
    }

    async saveAudio(audioData) {
        const data = {
            ...audioData,
            synced: false,
            savedAt: Date.now()
        };
        
        try {
            const id = await this.saveToStore('audio', data);
            
            if (navigator.onLine) {
                const fileName = `SG_Audio_${Date.now()}.webm`;
                const uploaded = await this.uploadToDrive(audioData.audio, fileName, audioData.mimeType || 'audio/webm');
                if (uploaded) {
                    await this.markAsSynced('audio', id);
                }
            }
            
            return id;
        } catch (e) {
            console.error('Save audio error:', e);
            return null;
        }
    }

    async saveAlert(alertData) {
        try {
            return await this.saveToStore('alerts', alertData);
        } catch (e) {
            console.error('Save alert error:', e);
            return null;
        }
    }

    // ---- Get Data ----
    async getPhotos(limit = 30) {
        return this.getFromStore('photos', limit);
    }

    async getAudioRecordings(limit = 20) {
        return this.getFromStore('audio', limit);
    }

    async getAlerts(limit = 50) {
        return this.getFromStore('alerts', limit);
    }

    // ---- Reset ----
    async resetAll() {
        localStorage.clear();
        
        if (this.db) {
            const storeNames = ['photos', 'audio', 'alerts', 'offlineQueue', 'settings'];
            for (let name of storeNames) {
                try {
                    await this.clearStore(name);
                } catch (e) {}
            }
        }
        
        try {
            indexedDB.deleteDatabase(this.dbName);
        } catch (e) {}
    }
}