class VirtualSidecar {
    constructor() {
        console.log("[xpod] VirtualSidecar Module Loaded - Embodiment Bridge");
        
        this.config = {
            serverUrl: "ws://localhost:8080/v1/soul-possess",
            targetSoul: "virtual-explorer-01"
        };
        
        this.ws = null;
        this.audioCtx = null;
        this.analyzer = null;
        this.videoStream = null;
        this.sensoryLoopInterval = null;
        this.audioAnimationId = null;
        this.isConnected = false;

        this.boundUpdateAudio = this.updateAudio.bind(this);
    }

    log(msg, type = "SYSTEM") {
        const consoleEl = document.getElementById('vs-console');
        if (!consoleEl) return;
        
        const div = document.createElement('div');
        div.style.marginBottom = "4px";
        
        const time = new Date().toLocaleTimeString();
        div.innerHTML = `<span style="color: rgba(0,255,0,0.4);">[${time}]</span> <span style="color: #fff;">[${type}]</span> ${msg}`;
        
        consoleEl.appendChild(div);
        consoleEl.scrollTop = consoleEl.scrollHeight;
        
        if (window.appLogger) {
            window.appLogger.log(type === "ERROR" ? "ERROR" : "INFO", "SIDECAR", msg);
        }
    }

    async renderUI(container) {
        container.innerHTML = `
            <h2 style="margin-top:0; border-bottom:1px solid rgba(0,255,0,0.3); padding-bottom:10px;">VIRTUAL SIDECAR [EMBODIMENT]</h2>
            
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00; display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 0.8rem; font-family: monospace; color: rgba(0,255,0,0.8);">
                    <div>SOUL_ID: <span id="vs-soul-id" style="color: #fff;">${this.config.targetSoul}</span></div>
                    <div style="margin-top: 4px;">STATUS: <span id="vs-connection-status" style="color: #ff003c;">DISCONNECTED</span></div>
                </div>
                <button id="vs-connect-btn" class="neon-btn" style="width: auto; padding: 5px 15px;">POSSESS BODY</button>
            </div>

            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 0.9rem; color: #fff; text-shadow: 0 0 5px #fff; display: flex; justify-content: space-between;">
                    <span>[1] VISUAL PERCEPTION (EYES)</span>
                    <span id="vs-fps-counter" style="color: #00ff00; font-size: 0.7rem;">0 FPS</span>
                </h3>
                <div style="position: relative; background: #000; border: 1px solid rgba(0,255,0,0.3); height: 180px; display: flex; justify-content: center; align-items: center; overflow: hidden;">
                    <video id="vs-webcam" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover; filter: grayscale(100%) contrast(1.2); opacity: 0.7;"></video>
                </div>
            </div>

            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 0.9rem; color: #fff; text-shadow: 0 0 5px #fff;">[2] AUDITORY PERCEPTION (EARS)</h3>
                <div id="vs-audio-visualizer" style="height: 40px; display: flex; align-items: flex-end; gap: 2px; border-bottom: 1px solid rgba(0,255,0,0.3); padding-bottom: 5px;">
                </div>
            </div>

            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 0.9rem; color: #fff; text-shadow: 0 0 5px #fff;">[3] BODY STATE (PROPRIOCEPTION)</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.8rem; font-family: monospace; color: rgba(0,255,0,0.8);">
                    <div style="background: rgba(0,0,0,0.5); padding: 5px; border: 1px solid rgba(0,255,0,0.2);">
                        BATTERY: <span id="vs-prop-battery" style="color: #fff;">--%</span>
                    </div>
                    <div style="background: rgba(0,0,0,0.5); padding: 5px; border: 1px solid rgba(0,255,0,0.2);">
                        LATENCY: <span id="vs-prop-latency" style="color: #fff;">0ms</span>
                    </div>
                </div>
            </div>
            
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 0.9rem; color: #fff; text-shadow: 0 0 5px #fff;">[4] SOUL EMOTIONAL ENGINE</h3>
                <div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: rgba(0,255,0,0.8); margin-bottom: 3px;">
                        <span>AROUSAL</span>
                        <span id="vs-val-arousal" style="color: #fff;">0.1</span>
                    </div>
                    <div style="width: 100%; height: 5px; background: rgba(0,0,0,0.8); border: 1px solid rgba(0,255,0,0.3);">
                        <div id="vs-bar-arousal" style="height: 100%; width: 10%; background: #0088ff; transition: width 0.5s ease;"></div>
                    </div>
                </div>
                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: rgba(0,255,0,0.8); margin-bottom: 3px;">
                        <span>VALENCE</span>
                        <span id="vs-val-valence" style="color: #fff;">0.5</span>
                    </div>
                    <div style="width: 100%; height: 5px; background: rgba(0,0,0,0.8); border: 1px solid rgba(0,255,0,0.3);">
                        <div id="vs-bar-valence" style="height: 100%; width: 50%; background: #00ff00; transition: width 0.5s ease;"></div>
                    </div>
                </div>
            </div>

            <div style="margin-top: 20px;">
                <div style="font-weight: bold; margin-bottom: 5px; color: #fff; text-shadow: 0 0 5px #fff; font-size: 0.9rem;">SIDECAR CONSOLE</div>
                <div id="vs-console" style="height: 150px; overflow-y: auto; background: rgba(0,0,0,0.8); border: 1px solid rgba(0,255,0,0.3); padding: 10px; font-size: 0.75rem; color: rgba(0,255,0,0.6); font-family: monospace;">
                    <div style="margin-bottom: 4px;"><span style="color: rgba(0,255,0,0.4);">[${new Date().toLocaleTimeString()}]</span> <span style="color: #fff;">[SYSTEM]</span> VIRTUAL_SIDECAR MODULE LOADED...</div>
                </div>
            </div>
            
            <button id="vs-disconnect-btn" class="neon-btn" style="margin-top: 20px; border-color: #ff003c; color: #ff003c; display: none;">SEVER EMBODIMENT</button>
        `;
        
        const visContainer = document.getElementById('vs-audio-visualizer');
        for(let i=0; i<16; i++) {
            const bar = document.createElement('div');
            bar.style.flexGrow = '1';
            bar.style.backgroundColor = 'rgba(0, 255, 0, 0.3)';
            bar.style.height = '2px';
            bar.style.transition = 'height 0.05s ease';
            visContainer.appendChild(bar);
        }

        document.getElementById('vs-connect-btn').addEventListener('click', async () => {
            const btn = document.getElementById('vs-connect-btn');
            btn.innerText = "INITIALISING SENSORS...";
            btn.disabled = true;
            
            if (!this.videoStream) {
                const hardwareReady = await this.initHardware();
                if (hardwareReady) {
                    this.connect();
                } else {
                    btn.innerText = "POSSESS BODY";
                    btn.disabled = false;
                }
            } else {
                this.connect();
            }
        });

        document.getElementById('vs-disconnect-btn').addEventListener('click', () => {
            this.disconnect();
        });

        this.initProprioception();
    }

    async initHardware() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 320, height: 240, frameRate: 15 }, 
                audio: true 
            });
            
            this.videoStream = stream;
            
            const videoEl = document.getElementById('vs-webcam');
            if (videoEl) {
                videoEl.srcObject = stream;
            }
            
            this.log("CAMERA & MIC INITIALISED", "HARDWARE");

            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioCtx.createMediaStreamSource(stream);
            this.analyzer = this.audioCtx.createAnalyser();
            this.analyzer.fftSize = 32;
            source.connect(this.analyzer);
            
            this.updateAudio();
            return true;
        } catch (e) {
            this.log(`PERMISSION_DENIED: ${e.message}`, "ERROR");
            return false;
        }
    }

    updateAudio() {
        if (!this.analyzer) return;
        
        const dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
        this.analyzer.getByteFrequencyData(dataArray);
        
        const visContainer = document.getElementById('vs-audio-visualizer');
        if (visContainer) {
            const bars = visContainer.children;
            for(let i=0; i<bars.length; i++) {
                const val = (dataArray[i] / 255) * 100;
                bars[i].style.height = `${Math.max(2, val)}%`;
                bars[i].style.backgroundColor = `rgba(0, 255, 0, ${0.2 + (val/100)})`;
            }
        }
        
        this.audioAnimationId = requestAnimationFrame(this.boundUpdateAudio);
    }

    async initProprioception() {
        if ('getBattery' in navigator) {
            try {
                const battery = await navigator.getBattery();
                const updateBat = () => {
                    const batEl = document.getElementById('vs-prop-battery');
                    if (batEl) batEl.innerText = `${Math.round(battery.level * 100)}%`;
                    this.sendTelemetry({ type: "proprioception", battery: battery.level });
                };
                battery.addEventListener('levelchange', updateBat);
                updateBat();
            } catch (e) {
                this.log("Battery API restricted.", "WARN");
            }
        }
    }

    connect() {
        this.log(`CONNECTING TO SOUL SERVER: ${this.config.serverUrl}`, "NETWORK");
        
        setTimeout(() => {
            this.isConnected = true;
            
            const statusEl = document.getElementById('vs-connection-status');
            if (statusEl) {
                statusEl.innerText = 'CONNECTED';
                statusEl.style.color = '#00ff00';
            }
            
            const connectBtn = document.getElementById('vs-connect-btn');
            if (connectBtn) connectBtn.style.display = 'none';
            
            const disconnectBtn = document.getElementById('vs-disconnect-btn');
            if (disconnectBtn) disconnectBtn.style.display = 'block';

            this.log(`POSSESSION SUCCESS: Linked to ${this.config.targetSoul}`, "SOUL");
            this.startSensoryLoop();
            
            this.simulateEmotionalFluctuation();
        }, 1000);
    }

    disconnect() {
        this.isConnected = false;
        clearInterval(this.sensoryLoopInterval);
        
        const statusEl = document.getElementById('vs-connection-status');
        if (statusEl) {
            statusEl.innerText = 'DISCONNECTED';
            statusEl.style.color = '#ff003c';
        }
        
        const connectBtn = document.getElementById('vs-connect-btn');
        if (connectBtn) {
            connectBtn.style.display = 'block';
            connectBtn.innerText = 'RE-POSSESS BODY';
            connectBtn.disabled = false;
        }
        
        const disconnectBtn = document.getElementById('vs-disconnect-btn');
        if (disconnectBtn) disconnectBtn.style.display = 'none';
        
        this.log("EMBODIMENT SEVERED.", "SOUL");
    }

    sendTelemetry(data) {
        if (!this.isConnected) return;
    }

    startSensoryLoop() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 160; 
        canvas.height = 120;

        const videoEl = document.getElementById('vs-webcam');

        this.sensoryLoopInterval = setInterval(() => {
            if (!this.isConnected || !videoEl) return;
            
            ctx.drawImage(videoEl, 0, 0, 160, 120);
            const frame = canvas.toDataURL('image/jpeg', 0.5);
            this.sendTelemetry({ type: "visual", data: frame });
            
            const fpsEl = document.getElementById('vs-fps-counter');
            if (fpsEl) fpsEl.innerText = `${Math.floor(Math.random()*2) + 14} FPS`;
            
            const latEl = document.getElementById('vs-prop-latency');
            if (latEl) latEl.innerText = `${Math.floor(Math.random()*15) + 20}ms`;
            
        }, 1000 / 15);
    }

    simulateEmotionalFluctuation() {
        setInterval(() => {
            if (!this.isConnected) return;
            
            const arousal = (Math.random() * 0.4 + 0.1).toFixed(2);
            const valence = (Math.random() * 0.6 + 0.2).toFixed(2);
            
            const arousalTxt = document.getElementById('vs-val-arousal');
            const valenceTxt = document.getElementById('vs-val-valence');
            const arousalBar = document.getElementById('vs-bar-arousal');
            const valenceBar = document.getElementById('vs-bar-valence');
            
            if (arousalTxt) arousalTxt.innerText = arousal;
            if (valenceTxt) valenceTxt.innerText = valence;
            if (arousalBar) arousalBar.style.width = `${arousal * 100}%`;
            if (valenceBar) valenceBar.style.width = `${valence * 100}%`;
            
        }, 3000);
    }
}

window.VirtualSidecar = VirtualSidecar;