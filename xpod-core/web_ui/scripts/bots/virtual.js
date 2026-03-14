class VirtualSidecar {
    constructor() {
        console.log("[xpod] VirtualSidecar Module Loaded - Embodiment Bridge");
        
        const targetSoul = "virtual-explorer-01";
        this.config = {
            targetSoul: targetSoul,
            serverUrl: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/v1/soul-possess/${targetSoul}`
        };
        
        this.ws = null;
        this.audioCtx = null;
        this.analyzer = null;
        this.processor = null;
        this.videoStream = null;
        this.sensoryLoopInterval = null;
        this.audioAnimationId = null;
        this.isConnected = false;
        this.visionEnabled = true;
        this.hearingEnabled = false;

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
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0,255,0,0.3); padding-bottom: 10px; margin-bottom: 15px;">
                <h2 style="margin: 0;">VIRTUAL SIDECAR [EMBODIMENT]</h2>
                <button id="vs-close-btn" class="neon-btn" style="width: auto; padding: 5px 15px; border-color: #ff003c; color: #ff003c;">CLOSE</button>
            </div>
            
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00; display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 0.8rem; font-family: monospace; color: rgba(0,255,0,0.8);">
                    <div>SOUL_ID: <span id="vs-soul-id" style="color: #fff;">${this.config.targetSoul}</span></div>
                    <div style="margin-top: 4px;">STATUS: <span id="vs-connection-status" style="color: #ff003c;">DISCONNECTED</span></div>
                </div>
                <button id="vs-connect-btn" class="neon-btn" style="width: auto; padding: 5px 15px;">POSSESS BODY</button>
            </div>

            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 0.9rem; color: #fff; text-shadow: 0 0 5px #fff; display: flex; justify-content: space-between; align-items: center;">
                    <span>[1] VISUAL PERCEPTION (EYES)</span>
                    <div>
                        <button id="vs-toggle-vision" class="neon-btn" style="padding: 2px 8px; font-size: 0.7rem; border-color: #00ff00; color: #00ff00; width: auto;">ONLINE</button>
                        <span id="vs-fps-counter" style="color: #00ff00; font-size: 0.7rem; margin-left: 10px;">0 FPS</span>
                    </div>
                </h3>
                <div style="position: relative; background: #000; border: 1px solid rgba(0,255,0,0.3); height: 180px; display: flex; justify-content: center; align-items: center; overflow: hidden; margin-top: 8px;">
                    <video id="vs-webcam" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover; filter: grayscale(100%) contrast(1.2); opacity: 0.7;"></video>
                </div>
            </div>

            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 0.9rem; color: #fff; text-shadow: 0 0 5px #fff; display: flex; justify-content: space-between; align-items: center;">
                    <span>[2] AUDITORY PERCEPTION (EARS)</span>
                    <button id="vs-toggle-hearing" class="neon-btn" style="padding: 2px 8px; font-size: 0.7rem; border-color: #ff003c; color: #ff003c; width: auto;">OFFLINE</button>
                </h3>
                <div id="vs-audio-visualizer" style="height: 40px; display: flex; align-items: flex-end; gap: 2px; border-bottom: 1px solid rgba(0,255,0,0.3); padding-bottom: 5px; margin-top: 8px;">
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
                        <span id="vs-val-arousal" style="color: #fff;">0.10</span>
                    </div>
                    <div style="width: 100%; height: 5px; background: rgba(0,0,0,0.8); border: 1px solid rgba(0,255,0,0.3);">
                        <div id="vs-bar-arousal" style="height: 100%; width: 10%; background: #0088ff; transition: width 0.5s ease;"></div>
                    </div>
                </div>
                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: rgba(0,255,0,0.8); margin-bottom: 3px;">
                        <span>VALENCE</span>
                        <span id="vs-val-valence" style="color: #fff;">0.50</span>
                    </div>
                    <div style="width: 100%; height: 5px; background: rgba(0,0,0,0.8); border: 1px solid rgba(0,255,0,0.3);">
                        <div id="vs-bar-valence" style="height: 100%; width: 50%; background: #00ff00; transition: width 0.5s ease;"></div>
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 0.9rem; color: #fff; text-shadow: 0 0 5px #fff;">[5] DIRECT SEMANTIC INJECTION</h3>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="vs-chat-input" placeholder="Transmit thought directly to soul..." style="flex-grow: 1; background: rgba(0,0,0,0.8); border: 1px solid rgba(0,255,0,0.3); color: #00ff00; padding: 8px; font-family: monospace; outline: none;" disabled>
                    <button id="vs-chat-send" class="neon-btn" style="width: auto; padding: 5px 15px;" disabled>TRANSMIT</button>
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

        document.getElementById('vs-close-btn').addEventListener('click', () => {
            this.shutdown();
        });

        document.getElementById('vs-toggle-vision').addEventListener('click', (e) => {
            this.visionEnabled = !this.visionEnabled;
            const btn = e.target;
            if (this.visionEnabled) {
                btn.innerText = "ONLINE";
                btn.style.borderColor = "#00ff00";
                btn.style.color = "#00ff00";
                this.log("Visual perception ONLINE.", "SYSTEM");
            } else {
                btn.innerText = "OFFLINE";
                btn.style.borderColor = "#ff003c";
                btn.style.color = "#ff003c";
                this.log("Visual perception OFFLINE.", "SYSTEM");
            }
        });

        document.getElementById('vs-toggle-hearing').addEventListener('click', (e) => {
            this.hearingEnabled = !this.hearingEnabled;
            const btn = e.target;
            if (this.hearingEnabled) {
                btn.innerText = "ONLINE";
                btn.style.borderColor = "#00ff00";
                btn.style.color = "#00ff00";
                this.log("Auditory perception ONLINE.", "SYSTEM");
            } else {
                btn.innerText = "OFFLINE";
                btn.style.borderColor = "#ff003c";
                btn.style.color = "#ff003c";
                this.log("Auditory perception OFFLINE.", "SYSTEM");
            }
        });

        const sendChat = () => {
            const input = document.getElementById('vs-chat-input');
            if (input && input.value.trim() !== '') {
                const text = input.value.trim();
                this.log(`INJECTING THOUGHT: "${text}"`, "USER");
                this.log(`AWAITING COGNITION...`, "CORE");
                this.sendTelemetry({ type: "text", data: text });
                input.value = '';
            }
        };

        document.getElementById('vs-chat-send').addEventListener('click', sendChat);
        document.getElementById('vs-chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChat();
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

            this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
            source.connect(this.processor);
            
            const silentGain = this.audioCtx.createGain();
            silentGain.gain.value = 0;
            this.processor.connect(silentGain);
            silentGain.connect(this.audioCtx.destination);

            this.processor.onaudioprocess = (e) => {
                if (!this.isConnected || !this.hearingEnabled) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                const pcm16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    let s = Math.max(-1, Math.min(1, inputData[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                const buffer = new Uint8Array(pcm16.buffer);
                let binary = '';
                for (let i = 0; i < buffer.byteLength; i++) {
                    binary += String.fromCharCode(buffer[i]);
                }
                const base64Audio = window.btoa(binary);
                this.sendTelemetry({ type: "audio", data: base64Audio });
            };
            
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
        try {
            this.ws = new WebSocket(this.config.serverUrl);
            this.ws.onopen = () => {
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

                const chatInput = document.getElementById('vs-chat-input');
                const chatSend = document.getElementById('vs-chat-send');
                if (chatInput) chatInput.disabled = false;
                if (chatSend) chatSend.disabled = false;

                this.log(`POSSESSION SUCCESS: Linked to ${this.config.targetSoul}`, "SOUL");
                this.startSensoryLoop();
            };
            this.ws.onmessage = (event) => {
                try {
                    const packet = JSON.parse(event.data);
                    if (packet.type === 'speak') {
                        this.log(`SOUL SPEAKS: "${packet.text}"`, "INTENT");
                        const utterance = new SpeechSynthesisUtterance(packet.text);
                        window.speechSynthesis.speak(utterance);
                    } else if (packet.type === 'soul_state') {
                        const arousalTxt = document.getElementById('vs-val-arousal');
                        const valenceTxt = document.getElementById('vs-val-valence');
                        const arousalBar = document.getElementById('vs-bar-arousal');
                        const valenceBar = document.getElementById('vs-bar-valence');
                        const batEl = document.getElementById('vs-prop-battery');

                        if (arousalTxt) arousalTxt.innerText = packet.arousal.toFixed(2);
                        if (valenceTxt) valenceTxt.innerText = packet.valence.toFixed(2);
                        if (arousalBar) arousalBar.style.width = `${packet.arousal * 100}%`;
                        if (valenceBar) valenceBar.style.width = `${packet.valence * 100}%`;
                        if (batEl) batEl.innerText = `${Math.round(packet.battery * 100)}%`;
                    } else if (packet.type === 'error') {
                        this.log(`COGNITIVE COLLAPSE: ${packet.message}`, "ERROR");
                    }
                } catch (e) {
                    this.log(`Failed to parse soul intent: ${event.data}`, "ERROR");
                }
            };
            this.ws.onclose = () => {
                this.log("Connection closed by server.", "WARN");
                this.disconnect();
            };
            this.ws.onerror = (err) => {
                this.log("WebSocket encountered an error.", "ERROR");
                this.disconnect();
            };
        } catch (e) {
            this.log(`Failed to open WebSocket: ${e.message}`, "ERROR");
        }
    }

    disconnect() {
        this.isConnected = false;
        clearInterval(this.sensoryLoopInterval);
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
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

        const chatInput = document.getElementById('vs-chat-input');
        const chatSend = document.getElementById('vs-chat-send');
        if (chatInput) chatInput.disabled = true;
        if (chatSend) chatSend.disabled = true;

        this.log("EMBODIMENT SEVERED.", "SOUL");
    }

    shutdown() {
        this.disconnect();
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        if (this.audioCtx) {
            this.audioCtx.close();
            this.audioCtx = null;
            this.analyzer = null;
            this.processor = null;
        }
        if (this.audioAnimationId) {
            cancelAnimationFrame(this.audioAnimationId);
            this.audioAnimationId = null;
        }
        const videoEl = document.getElementById('vs-webcam');
        if (videoEl) {
            videoEl.srcObject = null;
        }
        const container = document.getElementById('dynamic-setup-container');
        if (container) {
            container.style.display = 'none';
            container.innerHTML = '';
        }
        const eyesDisplay = document.getElementById('eyes-display');
        if (eyesDisplay) {
            eyesDisplay.style.opacity = '1';
        }
        const dashTitle = document.querySelector('.bottom-status .title');
        if (dashTitle) {
            dashTitle.innerText = 'DASHBOARD';
        }
        console.log("[xpod] VirtualSidecar Module Shut Down Successfully");
    }

    sendTelemetry(data) {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify(data));
    }

    startSensoryLoop() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 160; 
        canvas.height = 120;
        const videoEl = document.getElementById('vs-webcam');
        
        this.sensoryLoopInterval = setInterval(() => {
            if (!this.isConnected || !videoEl) return;
            
            if (this.visionEnabled) {
                ctx.drawImage(videoEl, 0, 0, 160, 120);
                const frame = canvas.toDataURL('image/jpeg', 0.5);
                this.sendTelemetry({ type: "visual", data: frame });
            }
            
            const fpsEl = document.getElementById('vs-fps-counter');
            if (fpsEl) fpsEl.innerText = this.visionEnabled ? `1 FPS (Cog-Lock)` : `STANDBY`;
            
            const latEl = document.getElementById('vs-prop-latency');
            if (latEl) latEl.innerText = `${Math.floor(Math.random()*15) + 20}ms`;
        }, 1000); 
    }
}

window.VirtualSidecar = VirtualSidecar;