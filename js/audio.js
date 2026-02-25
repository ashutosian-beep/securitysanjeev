// ============================================
// AUDIO MODULE - Silent Recording
// ============================================
class SilentAudio {
    constructor() {
        this.mediaRecorder = null;
        this.audioStream = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.recordingInterval = null;
        this.recordings = [];
    }

    async initMicrophone() {
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            console.log('Microphone initialized');
            return true;
        } catch (error) {
            console.error('Microphone init error:', error);
            return false;
        }
    }

    startRecording(durationSeconds = 10) {
        return new Promise(async (resolve) => {
            if (!this.audioStream) {
                const init = await this.initMicrophone();
                if (!init) {
                    resolve(null);
                    return;
                }
            }

            this.audioChunks = [];

            // Determine supported MIME type
            let mimeType = 'audio/webm';
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                mimeType = 'audio/webm;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                mimeType = 'audio/mp4';
            } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
                mimeType = 'audio/ogg';
            }

            try {
                this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });
            } catch (e) {
                this.mediaRecorder = new MediaRecorder(this.audioStream);
            }

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                const reader = new FileReader();
                reader.onloadend = () => {
                    const audioData = {
                        audio: reader.result,
                        timestamp: Date.now(),
                        datetime: new Date().toLocaleString('hi-IN'),
                        duration: durationSeconds,
                        mimeType: mimeType
                    };
                    this.recordings.push(audioData);
                    console.log(`Audio recorded: ${durationSeconds}s`);
                    resolve(audioData);
                };
                reader.readAsDataURL(audioBlob);
            };

            this.isRecording = true;
            this.mediaRecorder.start(1000); // Collect data every second

            // Stop after duration
            setTimeout(() => {
                if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.stop();
                    this.isRecording = false;
                }
            }, durationSeconds * 1000);
        });
    }

    startPeriodicRecording(intervalSeconds = 10, durationSeconds = 10, callback) {
        // First recording immediately
        this.startRecording(durationSeconds).then(audioData => {
            if (callback && audioData) callback(audioData);
        });

        // Periodic recordings
        this.recordingInterval = setInterval(() => {
            this.startRecording(durationSeconds).then(audioData => {
                if (callback && audioData) callback(audioData);
            });
        }, intervalSeconds * 1000);

        console.log(`Periodic recording started: every ${intervalSeconds}s, duration ${durationSeconds}s`);
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }

        if (this.recordingInterval) {
            clearInterval(this.recordingInterval);
            this.recordingInterval = null;
        }

        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }

        this.isRecording = false;
        console.log('Audio recording stopped');
    }

    getRecordings() {
        return this.recordings;
    }

    clearRecordings() {
        this.recordings = [];
    }
}