class VectorSetup {
    constructor() {
        console.log("[xpod] VectorSetup Module Loaded - Reverted BLE Framing + Preserved CLAD v2 Fixes");
        this.VECTOR_WRITE_UUID = '7d2a4bda-d29b-4152-b725-2491478c5cd7';
        this.VECTOR_NOTIFY_UUID = '30619f2d-0f54-41bd-a65a-7588d8c85b45';
        this.VECTOR_SERVICE_UUID = '0000fee3-0000-1000-8000-00805f9b34fb';
        
        this.boundHandleIncomingPacket = this.handleIncomingPacket.bind(this);
        this.boundHandleDisconnect = this.handleDisconnect.bind(this);

        this.multipartBuffer = new Uint8Array(0);
        this.isReceivingEncrypted = false;
        this.isSecureChannel = false;
        this.nonceAckSent = false;
        this.pendingChallenge = null;
        this.clientKeyPair = null;
        this.robotPublicKey = null;
        this.toRobotNonce = null;
        this.toDeviceNonce = null;
        this.rxKey = null;
        this.txKey = null;
        this.device = null;
        this.writeChar = null;
        this.notifyChar = null;
        this.networks = [];
        this.botInfo = null;
        this.lastUsedWifi = null;
        this.botIp = null;
        this.rtsVersion = 5; 
    }

    bufToHex(buf) {
        return Array.from(new Uint8Array(buf))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
    }

    async updateStatus(text, quoteRef = null) {
        const statusText = document.getElementById('vector-setup-status');
        if (!statusText) return;
        
        let finalOutput = `> ${text}`;
        
        if (quoteRef && window.quoteManager) {
            try {
                const quote = await window.quoteManager.getRandomQuote(quoteRef);
                if (quote) {
                    finalOutput += `<br><span style="color: rgba(0, 255, 0, 0.6); font-style: italic; font-size: 0.85em; margin-top: 5px; display: block;">"${quote}"</span>`;
                }
            } catch (e) {
                console.warn("QuoteManager error:", e);
            }
        }
        
        statusText.innerHTML = finalOutput;
    }

    async renderUI(container) {
        container.innerHTML = `
            <h2 style="margin-top:0; border-bottom:1px solid rgba(0,255,0,0.3); padding-bottom:10px;">VECTOR ACTIVATION</h2>
            <div style="margin-bottom: 20px; padding: 15px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 1rem; color: #fff; text-shadow: 0 0 5px #fff;">[1] PREREQUISITE</h3>
                <p style="margin-bottom: 0; font-size: 0.9rem; line-height: 1.4; color: rgba(0,255,0,0.8);">Vector must be unlocked and connected to local Wi-Fi via <a href="https://unlock-prod.froggitti.net/" target="_blank" style="color: #00ff00; text-decoration: underline;">froggitti</a> before proceeding.</p>
            </div>
            <button id="vector-ble-pair-btn" class="neon-btn">INITIATE BLUETOOTH PAIRING</button>
            
            <div id="pin-entry-section" style="display: none; margin-top: 20px; padding: 15px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 1rem; color: #fff; text-shadow: 0 0 5px #fff;">[2] AUTHORISATION</h3>
                <p style="margin-bottom: 10px; font-size: 0.9rem; color: rgba(0,255,0,0.8);">Enter the 6-digit PIN displayed on Vector's screen.</p>
                <input type="text" id="vector-pin-input" maxlength="6" placeholder="000000" style="text-align: center; font-size: 1.5rem; letter-spacing: 10px; margin-bottom: 15px;">
                <button id="submit-pin-btn" class="neon-btn">AUTHORISE CONNECTION</button>
            </div>

            <div id="vector-status-dashboard" style="display: none; margin-top: 20px; padding: 15px; background: rgba(0, 30, 0, 0.4); border: 1px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 1rem; color: #fff; text-shadow: 0 0 5px #fff; border-bottom: 1px solid rgba(0,255,0,0.2); padding-bottom: 5px;">BOT STATUS</h3>
                <div style="display: grid; grid-template-columns: 1fr 1.5fr; gap: 5px; font-size: 0.8rem; font-family: monospace;">
                    <div style="color: rgba(0,255,0,0.6);">ESN:</div><div id="status-esn">---</div>
                    <div style="color: rgba(0,255,0,0.6);">OS VER:</div><div id="status-os">---</div>
                    <div style="color: rgba(0,255,0,0.6);">WIFI:</div><div id="status-wifi">---</div>
                    <div style="color: rgba(0,255,0,0.6);">AUTH:</div><div id="status-auth">---</div>
                    <div style="color: rgba(0,255,0,0.6);">OWNER:</div><div id="status-owner">---</div>
                </div>
            </div>

            <div id="vector-control-panel" style="display: none; margin-top: 20px; padding: 15px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 1rem; color: #fff; text-shadow: 0 0 5px #fff;">[3] COMMAND CONSOLE</h3>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button id="request-status-btn" class="neon-btn" style="flex: 1; min-width: 150px;">GET ROBOT STATUS</button>
                    <button id="wifi-scan-btn" class="neon-btn" style="flex: 1; min-width: 150px;">SCAN WI-FI NETWORKS</button>
                </div>
            </div>

            <div id="wifi-connection-section" style="display: none; margin-top: 20px; padding: 15px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 1rem; color: #fff; text-shadow: 0 0 5px #fff;">[4] WI-FI CONFIGURATION</h3>
                <select id="wifi-network-select" style="width: 100%; margin-bottom: 10px; background: #000; color: #00ff00; border: 1px solid #00ff00; padding: 5px;"></select>
                <input type="password" id="wifi-password-input" placeholder="PASSWORD" style="width: 100%; margin-bottom: 10px; background: #000; color: #00ff00; border: 1px solid #00ff00; padding: 5px;">
                <button id="wifi-connect-btn" class="neon-btn" style="width: 100%;">CONNECT TO NETWORK</button>
            </div>

            <div id="vector-next-steps" style="display: none; margin-top: 20px; padding: 15px; background: rgba(0, 30, 0, 0.4); border-left: 3px solid #00ff00;">
                <h3 style="margin-top: 0; font-size: 1rem; color: #fff; text-shadow: 0 0 5px #fff;">[5] FINALISATION</h3>
                <div id="ota-ui-container" style="margin-bottom: 15px;">
                    <input type="text" id="ota-url-input" placeholder="OTA HTTP URL" style="width: 100%; margin-bottom: 5px; background: #000; color: #00ff00; border: 1px solid #00ff00; padding: 5px;">
                    <button id="ota-update-btn" class="neon-btn" style="width: 100%;">TRIGGER OTA UPDATE</button>
                    
                    <div id="ota-progress-wrap" style="display: none; margin-top: 10px; background: rgba(0,255,0,0.1); border: 1px solid #00ff00; height: 30px; position: relative; overflow: hidden;">
                        <div id="ota-progress-bar" style="background: #00ff00; height: 100%; width: 0%; transition: width 0.3s ease;"></div>
                        <div id="ota-progress-text" style="position: absolute; top:0; left:0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.8rem; font-weight: bold; text-shadow: 1px 1px 2px #000;">0%</div>
                    </div>
                    <button id="ota-restart-btn" class="neon-btn" style="display: none; width: 100%; margin-top: 10px; border-color: #ff003c; color: #ff003c;">RESTART VECTOR</button>
                </div>
                
                <div id="ssh-provision-section" style="border-top: 1px solid rgba(0,255,0,0.3); padding-top: 10px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span style="font-size: 0.8rem; color: rgba(0,255,0,0.8);">LAN IP ADDRESS:</span>
                        <span id="status-lan-ip" style="font-size: 0.8rem; color: #fff; font-family: monospace;">AWAITING WI-FI...</span>
                    </div>
                    <button id="ssh-provision-btn" class="neon-btn" style="width: 100%; border-color: #0088ff; color: #0088ff;" disabled>PROVISION BOT (SSH)</button>
                </div>

                <div style="border-top: 1px solid rgba(0,255,0,0.3); padding-top: 10px;">
                    <button id="cloud-auth-btn" class="neon-btn" style="width: 100%; opacity: 0.5;" disabled>AUTHORISE CLOUD SESSION</button>
                </div>
            </div>

            <p id="vector-setup-status" style="color: #00ff00; font-size: 0.9rem; margin-top: 15px;"></p>
            <div style="margin-top: 20px;">
                <div style="font-weight: bold; margin-bottom: 5px; color: #fff; text-shadow: 0 0 5px #fff;">DIAGNOSTIC FEED</div>
                <div id="vector-diagnostic-feed" style="height: 250px; overflow-y: auto;"></div>
            </div>
            <button id="vector-abort-btn" class="neon-btn" style="margin-top: 20px; border-color: #ff003c; color: #ff003c;">ABORT</button>
        `;
        const diagFeed = document.getElementById('vector-diagnostic-feed');
        if (window.appLogger) {
            window.appLogger.setFeedElement(diagFeed);
        }
        document.getElementById('vector-ble-pair-btn').addEventListener('click', () => this.startPairing());
        document.getElementById('submit-pin-btn').addEventListener('click', () => this.submitPin());
        document.getElementById('request-status-btn').addEventListener('click', () => this.requestStatus());
        document.getElementById('wifi-scan-btn').addEventListener('click', () => this.startWifiScan());
        document.getElementById('wifi-connect-btn').addEventListener('click', () => this.connectToWifi());
        document.getElementById('ota-update-btn').addEventListener('click', () => this.triggerOtaUpdate());
        document.getElementById('ota-restart-btn').addEventListener('click', () => this.rebootRobot());
        document.getElementById('ssh-provision-btn').addEventListener('click', () => this.provisionBotSsh());
        document.getElementById('cloud-auth-btn').addEventListener('click', () => this.cloudAuthorize());
        document.getElementById('vector-abort-btn').addEventListener('click', () => this.abortSetup());
    }

    async handleDisconnect() {
        if (window.appLogger) window.appLogger.log('CRITICAL', 'FROM ROBOT', 'Robot severed GATT connection.');
        await this.updateStatus("OFFLINE. CONNECTION LOST.", "connect_drop");
        
        this.isSecureChannel = false;
        this.isReceivingEncrypted = false;
        
        if (this.notifyChar) {
            try {
                this.notifyChar.removeEventListener('characteristicvaluechanged', this.boundHandleIncomingPacket);
            } catch(e) {}
        }
    }

    async abortSetup() {
        if (window.appLogger) window.appLogger.log('WARN', 'LOCAL', 'Setup aborted by user.');
        await this.updateStatus("SETUP CANCELLED.", "pairing_cancelled");
        
        try {
            if (this.writeChar && this.isSecureChannel) {
                if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'Sending Force Disconnect to robot to reset switchboard state...');
                await this.sendEncrypted(new Uint8Array([0x04, this.rtsVersion, 0x11]));
            }
        } catch(e) {}

        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }
        setTimeout(() => {
            document.getElementById('dynamic-setup-container').style.display = 'none';
            document.getElementById('eyes-display').style.opacity = '1';
            const dashTitle = document.querySelector('.bottom-status .title');
            if (dashTitle) dashTitle.innerText = 'DASHBOARD';
        }, 2000);
    }

    async sendFramedPayload(writeChar, payload) {
        const totalLen = payload.length;
        if (window.appLogger) window.appLogger.log('DEBUG', 'BLE_TX_PAYLOAD', `Payload to frame (${totalLen} bytes): ${this.bufToHex(payload)}`);
        
        if (totalLen <= 19) {
            const header = 0xC0 | totalLen;
            const chunk = new Uint8Array(1 + totalLen);
            chunk[0] = header;
            chunk.set(payload, 1);
            if (window.appLogger) window.appLogger.log('DEBUG', 'BLE_TX_CHUNK', `Writing single chunk: ${this.bufToHex(chunk)}`);
            await writeChar.writeValueWithoutResponse(chunk);
            return;
        }
        
        let offset = 0;
        let isFirst = true;
        while (offset < totalLen) {
            const bytesRemaining = totalLen - offset;
            const chunkLen = Math.min(19, bytesRemaining);
            const isLast = bytesRemaining <= 19;
            let multipart = 0;
            if (isFirst) multipart = 2;
            else if (isLast) multipart = 1;
            else multipart = 0;
            
            const header = (multipart << 6) | chunkLen;
            const chunk = new Uint8Array(1 + chunkLen);
            chunk[0] = header;
            chunk.set(payload.subarray(offset, offset + chunkLen), 1);
            
            if (window.appLogger) window.appLogger.log('DEBUG', 'BLE_TX_CHUNK', `Writing multipart chunk: ${this.bufToHex(chunk)}`);
            await writeChar.writeValueWithoutResponse(chunk);
            
            offset += chunkLen;
            isFirst = false;
            if (!isLast) await new Promise(r => setTimeout(r, 100));
        }
    }

    async sendEncrypted(payload) {
        try {
            if (window.appLogger) window.appLogger.log('DEBUG', 'BLE_TX_PLAINTEXT', `Encrypting payload: ${this.bufToHex(payload)}`);
            const sodium = window.sodium;
            const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
                payload,
                null,
                null, 
                this.toRobotNonce,
                this.txKey
            );
            sodium.increment(this.toRobotNonce);
            await this.sendFramedPayload(this.writeChar, ciphertext);
        } catch (error) {
            if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', `Encryption failed: ${error.message}`);
        }
    }

    async requestStatus() {
        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'Requesting robot status...');
        await this.sendEncrypted(new Uint8Array([0x04, this.rtsVersion, 0x0A]));
    }

    async requestWifiIp() {
        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'Requesting robot LAN IP address...');
        await this.sendEncrypted(new Uint8Array([0x04, this.rtsVersion, 0x08]));
    }

    async startWifiScan() {
        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'Triggering Wi-Fi scan...');
        await this.sendEncrypted(new Uint8Array([0x04, this.rtsVersion, 0x0C]));
    }

    async rebootRobot() {
        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'Sending Force Restart command (Tag 0x11)...');
        await this.sendEncrypted(new Uint8Array([0x04, this.rtsVersion, 0x11]));
    }

    async connectToWifi(targetNetwork = null, targetPassword = null) {
        const ssid = targetNetwork || document.getElementById('wifi-network-select').value;
        const password = targetPassword || document.getElementById('wifi-password-input').value;
        
        const net = this.networks.find(n => n.ssid === ssid);
        if (!net && !targetNetwork) {
            if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', `Target network metadata (${ssid}) not found.`);
            return;
        }

        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Initiating connection to ${ssid}...`);
        await this.updateStatus("CONNECTING TO WI-FI...", "wifi_connecting");

        this.lastUsedWifi = { ssid, password };

        const ssidHexBytes = new TextEncoder().encode(net ? net.ssidHex : Array.from(ssid).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
        const passBytes = new TextEncoder().encode(password);

        const payload = new Uint8Array(3 + 1 + ssidHexBytes.length + 1 + passBytes.length + 1 + 1 + 1);
        payload[0] = 0x04;
        payload[1] = this.rtsVersion;
        payload[2] = 0x06;
        
        let pos = 3;
        payload[pos++] = ssidHexBytes.length;
        payload.set(ssidHexBytes, pos);
        pos += ssidHexBytes.length;
        
        payload[pos++] = passBytes.length;
        payload.set(passBytes, pos);
        pos += passBytes.length;
        
        payload[pos++] = 15; 
        payload[pos++] = net ? net.authType : 0x00;
        payload[pos++] = net ? (net.hidden ? 1 : 0) : 0;

        await this.sendEncrypted(payload);
    }

    async triggerOtaUpdate() {
        const url = document.getElementById('ota-url-input').value;
        if (!url) {
            if (window.appLogger) window.appLogger.log('WARN', 'LOCAL', 'OTA URL cannot be empty.');
            return;
        }
        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Requesting OTA update from: ${url}`);
        
        const urlBytes = new TextEncoder().encode(url);
        const payload = new Uint8Array(3 + 1 + urlBytes.length);
        payload[0] = 0x04;
        payload[1] = this.rtsVersion;
        payload[2] = 0x0E;
        payload[3] = urlBytes.length;
        payload.set(urlBytes, 4);

        await this.sendEncrypted(payload);
        
        document.getElementById('ota-progress-wrap').style.display = 'block';
        document.getElementById('ota-restart-btn').style.display = 'none';
    }

    async provisionBotSsh() {
        if (!this.botIp || !this.botInfo || !this.botInfo.esn) {
            if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', 'Cannot provision: Missing IP or ESN. Check Wi-Fi connection.');
            return;
        }

        const btn = document.getElementById('ssh-provision-btn');
        btn.disabled = true;
        btn.innerText = "PROVISIONING VIA SSH...";
        await this.updateStatus("INJECTING DNS AND CERTS VIA SSH...", "provisioning");
        
        try {
            if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Requesting xpod-core to SSH provision bot at ${this.botIp}`);
            const response = await fetch('/api/core/provision_bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    ip: this.botIp, 
                    esn: this.botInfo.esn,
                    server_ip: window.location.hostname
                })
            });
            
            if (response.ok) {
                if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'SSH Provisioning successful.');
                await this.updateStatus("PROVISIONING COMPLETE. READY FOR CLOUD AUTH.", "provisioning_success");
                
                btn.innerText = "PROVISIONED [OK]";
                btn.style.color = "#00ff00";
                btn.style.borderColor = "#00ff00";
                btn.style.opacity = "0.4";
                btn.style.cursor = "default";
                btn.disabled = true;
                
                const authBtn = document.getElementById('cloud-auth-btn');
                authBtn.disabled = false;
                authBtn.style.opacity = '1';
            } else {
                const errText = await response.text();
                throw new Error(errText);
            }
        } catch (e) {
            if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', `SSH Provisioning failed: ${e.message}`);
            await this.updateStatus(`PROVISIONING FAILED: ${e.message}`, "error_general");
            btn.disabled = false;
            btn.innerText = "RETRY PROVISION BOT (SSH)";
            btn.style.color = "#ff003c";
            btn.style.borderColor = "#ff003c";
        }
    }

    async cloudAuthorize() {
        if (!this.botInfo || (this.botInfo.wifiState !== 1)) {
            if (window.appLogger) window.appLogger.log('WARN', 'LOCAL', 'Robot is offline. Attempting Wi-Fi reconnection before authorisation.');
            if (this.lastUsedWifi) {
                await this.connectToWifi(this.lastUsedWifi.ssid, this.lastUsedWifi.password);
                return;
            } else {
                await this.updateStatus("ERR: ROBOT OFFLINE. CONNECT WI-FI FIRST.", "error_general");
                return;
            }
        }

        const sessionToken = "xpod_token";
        const clientName = "Web-Setup";
        const appId = "com.anki.vector";
        
        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Preparing Cloud Authorisation Request [V5]`);
        if (window.appLogger) window.appLogger.log('DEBUG', 'LOCAL', `Auth Params -> Token: ${sessionToken}, Client: ${clientName}, AppId: ${appId}`);

        const encoder = new TextEncoder();
        const tokenBytes = encoder.encode(sessionToken);
        const nameBytes = encoder.encode(clientName);
        const appBytes = encoder.encode(appId);

        const totalLength = 3 + 1 + tokenBytes.length + 1 + nameBytes.length + 1 + appBytes.length;
        const payload = new Uint8Array(totalLength);

        let offset = 0;
        payload.set([0x04, this.rtsVersion, 0x1D], offset);
        offset += 3;

        payload[offset] = tokenBytes.length;
        offset += 1;
        payload.set(tokenBytes, offset);
        offset += tokenBytes.length;

        payload[offset] = nameBytes.length;
        offset += 1;
        payload.set(nameBytes, offset);
        offset += nameBytes.length;

        payload[offset] = appBytes.length;
        offset += 1;
        payload.set(appBytes, offset);

        if (window.appLogger) window.appLogger.log('DEBUG', 'LOCAL', `Cloud Auth Payload Packed (${totalLength} bytes): ${this.bufToHex(payload)}`);
        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Submitting Cloud Authorisation Request to Robot with token: ${sessionToken}`);
        
        await this.updateStatus("AUTHORISING CLOUD SESSION WITH ROBOT...", "provisioning");

        try {
            if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Instructing sidecar to tail SSH logs for ${this.botIp}...`);
            await fetch('/api/vector/diagnostics/tail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: this.botIp })
            });
        } catch (e) {
            if (window.appLogger) window.appLogger.log('WARN', 'LOCAL', `Could not start SSH tail: ${e.message}`);
        }

        await this.sendEncrypted(payload);
    }

    parseWifiScan(data) {
        const status = data[0];
        const count = data[1];
        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Scan Result - Status: ${status}, Networks found: ${count}`);
        
        const select = document.getElementById('wifi-network-select');
        const wifiSection = document.getElementById('wifi-connection-section');
        if (select) select.innerHTML = '';
        this.networks = [];

        let offset = 2; 
        const decoder = new TextDecoder();

        for (let i = 0; i < count; i++) {
            if (offset + 3 > data.length) break;
            const authType = data[offset];
            const signal = data[offset + 1];
            const ssidLen = data[offset + 2];
            
            if (offset + 3 + ssidLen > data.length) break;
            
            const ssidHexASCII = decoder.decode(data.slice(offset + 3, offset + 3 + ssidLen));
            
            let ssid = "";
            for (let j = 0; j < ssidHexASCII.length; j += 2) {
                ssid += String.fromCharCode(parseInt(ssidHexASCII.slice(j, j + 2), 16));
            }
            
            const hidden = data[offset + 3 + ssidLen] === 0x01;
            const provisioned = data[offset + 4 + ssidLen] === 0x01;

            this.networks.push({ ssid, ssidHex: ssidHexASCII, authType, signal, hidden, provisioned });

            const opt = document.createElement('option');
            opt.value = ssid;
            opt.text = `${ssid} (${signal}%)`;
            if (select) select.appendChild(opt);

            if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Network ${i + 1}: ${ssid} [Signal: ${signal}, Auth: ${authType}, Hidden: ${hidden}, Provisioned: ${provisioned}]`);
            offset += 5 + ssidLen;
        }

        if (wifiSection) wifiSection.style.display = 'block';
    }

    async parseStatusResponse(data) {
        let offset = 0;
        const decoder = new TextDecoder();

        const ssidLen = data[offset++];
        const ssidHexASCII = decoder.decode(data.slice(offset, offset + ssidLen));
        offset += ssidLen;
        let ssid = "";
        for (let j = 0; j < ssidHexASCII.length; j += 2) {
            ssid += String.fromCharCode(parseInt(ssidHexASCII.slice(j, j + 2), 16));
        }

        const wifiState = data[offset++];
        const apMode = data[offset++] === 0x01;
        const bleState = data[offset++];
        const batteryState = data[offset++];

        const osVersionLen = data[offset++];
        const osVersion = decoder.decode(data.slice(offset, offset + osVersionLen));
        offset += osVersionLen;

        const esnLen = data[offset++];
        const esn = decoder.decode(data.slice(offset, offset + esnLen));
        offset += esnLen;

        const otaInProgress = data[offset++] === 0x01;
        const hasOwner = data[offset++] === 0x01;
        const isCloudAuthed = data[offset++] === 0x01;

        this.botInfo = {
            ssid, wifiState, apMode, bleState, batteryState,
            osVersion, esn, otaInProgress, hasOwner, isCloudAuthed
        };

        document.getElementById('vector-status-dashboard').style.display = 'block';
        document.getElementById('status-esn').innerText = esn;
        document.getElementById('status-os').innerText = osVersion.split('_')[0]; 
        document.getElementById('status-wifi').innerText = wifiState === 1 ? `CONNECTED (${ssid})` : "DISCONNECTED";
        document.getElementById('status-wifi').style.color = wifiState === 1 ? "#00ff00" : "#ff003c";
        document.getElementById('status-auth').innerText = isCloudAuthed ? "AUTHENTICATED" : "UNAUTHORIZED";
        document.getElementById('status-auth').style.color = isCloudAuthed ? "#00ff00" : "#ff003c";
        document.getElementById('status-owner').innerText = hasOwner ? "YES" : "NO";

        await this.updateStatus(`STATUS LOADED: ${esn}`, "msg_received");

        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Bot Status Parsed -> ESN: ${esn}, OS: ${osVersion}, WiFi: ${wifiState === 1 ? 'ONLINE' : 'OFFLINE'}`);
        
        const nextSteps = document.getElementById('vector-next-steps');
        if (nextSteps) nextSteps.style.display = 'block';

        if (wifiState === 1 && !this.botIp) {
            this.requestWifiIp();
        }
    }

    async handleOtaProgress(data) {
        const statusCode = data[0];
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        
        const current = view.getUint32(1, true); 
        const total = view.getUint32(9, true);

        const progressBar = document.getElementById('ota-progress-bar');
        const progressText = document.getElementById('ota-progress-text');
        const restartBtn = document.getElementById('ota-restart-btn');

        if (statusCode === 0x02) {
            const percentage = total > 0 ? Math.min(100, Math.floor((current / total) * 100)) : 0;
            if (progressBar) progressBar.style.width = `${percentage}%`;
            if (progressText) progressText.innerText = `${percentage}% (Processing)`;
            if (current === 0) await this.updateStatus("OTA: TRANSITIONING TO FLASH PHASE...", "ota_start");
        } else if (statusCode === 0x03) {
            if (progressBar) progressBar.style.width = `100%`;
            if (progressText) progressText.innerText = `OTA COMPLETE`;
            await this.updateStatus("OTA INSTALLATION SUCCESSFUL.", "ota_complete");
            if (restartBtn) restartBtn.style.display = 'block';
        } else if (statusCode === 0x04) {
            await this.updateStatus("ROBOT REBOOTING. CONNECTION WILL DROP.", "disconnect");
            if (window.appLogger) window.appLogger.log('WARN', 'LOCAL', 'Robot issued reboot command after OTA.');
        } else if (statusCode === 0x05) {
            await this.updateStatus("OTA FAILED. CHECK LOGS.", "error_general");
            if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', 'OTA error status received from robot.');
        }
    }

    async processSecurePayload(encryptedPayload) {
        try {
            const sodium = window.sodium;
            const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
                null, encryptedPayload, null, this.toDeviceNonce, this.rxKey
            );
            this.pendingChallenge = null;
            sodium.increment(this.toDeviceNonce);
            
            if (window.appLogger) window.appLogger.log('INFO', 'FROM ROBOT (SECURE)', `Decrypted plaintext: ${this.bufToHex(plaintext)}`);

            if (plaintext.length >= 3 && plaintext[0] === 0x04) {
                const cladTag = plaintext[2];

                if (cladTag === 0x04) {
                    const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
                    const challengeNum = view.getUint32(3, true);
                    const responsePlaintext = new Uint8Array(plaintext);
                    const responseView = new DataView(responsePlaintext.buffer, responsePlaintext.byteOffset, responsePlaintext.byteLength);
                    responseView.setUint32(3, challengeNum + 1, true);
                    await this.sendEncrypted(responsePlaintext);
                    await this.updateStatus("CHALLENGE ANSWERED. AWAITING CONFIRMATION...", "send_key");
                } else if (cladTag === 0x05) {
                    await this.updateStatus("SECURE PAIRING COMPLETE!", "handshake_accepted");
                    document.getElementById('vector-control-panel').style.display = 'block';
                    await this.sendEncrypted(new Uint8Array([0x04, this.rtsVersion, 0x12, 0x05]));
                    this.requestStatus(); 
                } else if (cladTag === 0x07) {
                    const ssidLen = plaintext[3];
                    const connectResult = plaintext[5 + ssidLen];
                    let resultMsg = "FAILURE";
                    if (connectResult === 0x00) resultMsg = "SUCCESS";
                    else if (connectResult === 0x02) resultMsg = "INVALID PASSWORD";
                    
                    if (window.appLogger) window.appLogger.log('INFO', 'FROM ROBOT (SECURE)', `Wi-Fi connection result: ${resultMsg}`);
                    await this.updateStatus(`WI-FI: ${resultMsg}`, connectResult === 0x00 ? "success" : "wifi_auth_failed");
                    
                    if (connectResult === 0x00) {
                        this.requestStatus();
                        setTimeout(() => this.requestWifiIp(), 2000);
                    }
                } else if (cladTag === 0x09) {
                    const hasIpv4 = plaintext[3];
                    if (hasIpv4 === 0x01) {
                        this.botIp = `${plaintext[5]}.${plaintext[6]}.${plaintext[7]}.${plaintext[8]}`;
                        if (window.appLogger) window.appLogger.log('INFO', 'FROM ROBOT (SECURE)', `Acquired IP Address: ${this.botIp}`);
                        
                        const ipSpan = document.getElementById('status-lan-ip');
                        if (ipSpan) ipSpan.innerText = this.botIp;
                        
                        const provBtn = document.getElementById('ssh-provision-btn');
                        if (provBtn) {
                            provBtn.disabled = false;
                            provBtn.innerText = "PROVISION BOT (SSH)";
                        }
                        await this.updateStatus("IP ACQUIRED. READY FOR SSH PROVISIONING.", "characteristics_found");
                    }
                } else if (cladTag === 0x0B) {
                    await this.parseStatusResponse(plaintext.slice(3));
                } else if (cladTag === 0x0D) {
                    this.parseWifiScan(plaintext.slice(3));
                } else if (cladTag === 0x0F) {
                    await this.handleOtaProgress(plaintext.slice(3));
                } else if (cladTag === 0x1E) {
                    const success = plaintext[3] === 0x01;
                    const statusCode = plaintext[4];
                    const guidLen = plaintext[5];
                    const guid = new TextDecoder().decode(plaintext.slice(6, 6 + guidLen));
                    
                    if (window.appLogger) window.appLogger.log('INFO', 'FROM ROBOT (SECURE)', `Cloud Auth Result Received! Success: ${success}, Status Code: ${statusCode}`);
                    if (window.appLogger) window.appLogger.log('DEBUG', 'FROM ROBOT (SECURE)', `Extracted Token GUID: '${guid}' (Length: ${guidLen})`);
                    
                    if (success) {
                        if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Robot Accepted Cloud Session. Authorised GUID: ${guid}`);
                        await this.updateStatus("ROBOT PAIRED! REGISTERING WITH SIDECAR...", "provisioning");
                        this.requestStatus();
                        
                        try {
                            if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Invoking Sidecar API: POST /api/vector/sidecar/connect`);
                            if (window.appLogger) window.appLogger.log('DEBUG', 'LOCAL', `Registration Payload -> ESN: ${this.botInfo.esn}, IP: ${this.botIp}, GUID: ${guid}`);
                            
                            const regResponse = await fetch('/api/vector/sidecar/connect', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ esn: this.botInfo.esn, ip: this.botIp, client_token_guid: guid })
                            });

                            if (regResponse.ok) {
                                if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Sidecar API Registration Successful.`);
                                await this.updateStatus("ACCOUNT PAIRED & REGISTERED! READY FOR SIDECAR.", "provisioning_success");
                                
                                const authBtn = document.getElementById('cloud-auth-btn');
                                if(authBtn) {
                                    authBtn.innerText = "AUTHENTICATED [OK]";
                                    authBtn.style.color = "#00ff00";
                                    authBtn.style.borderColor = "#00ff00";
                                    authBtn.style.opacity = "0.4";
                                    authBtn.disabled = true;
                                }
                            } else {
                                const errText = await regResponse.text();
                                if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', `Sidecar API Registration Failed. HTTP ${regResponse.status}: ${errText}`);
                                throw new Error(`HTTP ${regResponse.status}`);
                            }
                        } catch (apiError) {
                            if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', `Sidecar API Exception during registration: ${apiError.message}`);
                            await this.updateStatus(`API REGISTRATION FAILED: ${apiError.message}`, "error_general");
                        }
                    } else {
                        const statusMap = {
                            0: "UnknownError", 1: "ConnectionError", 2: "WrongAccount",
                            3: "InvalidSessionToken", 4: "AuthorizedAsPrimary",
                            5: "AuthorizedAsSecondary", 6: "Reauthorized"
                        };
                        const statusStr = statusMap[statusCode] || "UNRECOGNISED_CODE";
                        if (window.appLogger) window.appLogger.log('ERROR', 'FROM ROBOT (SECURE)', `Robot Rejected Cloud Session: ${statusStr} (Code ${statusCode})`);
                        await this.updateStatus(`CLOUD AUTH FAILED: ${statusStr} (${statusCode})`, "error_general");
                    }
                }
            }
        } catch (error) {
            if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', `Failed to decrypt secure payload: ${error.message}`);
            this.isSecureChannel = false;
            this.isReceivingEncrypted = false;
            this.nonceAckSent = false;
            document.getElementById('pin-entry-section').style.display = 'block';
        }
    }

    async processPayload(payload, isEncryptedHeaderFlag) {
        const isActuallyEncrypted = (isEncryptedHeaderFlag || this.isSecureChannel) && (payload.length >= 16);
        if (window.appLogger) window.appLogger.log('DEBUG', 'BLE_RX_ASSEMBLED', `Assembled payload (HeaderFlag: ${isEncryptedHeaderFlag}, SecureChannel: ${this.isSecureChannel}, TreatedAsEncrypted: ${isActuallyEncrypted}): ${this.bufToHex(payload)}`);
        
        if (isActuallyEncrypted) {
            await this.processSecurePayload(payload);
            return;
        }
        
        const setupMsgType = payload[0];
        const dataPayload = payload.slice(1);
        
        if (setupMsgType === 0x01 && dataPayload.length === 4) {
            const version = new DataView(dataPayload.buffer, dataPayload.byteOffset, dataPayload.byteLength).getUint32(0, true);
            this.rtsVersion = version; 
            if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Robot acknowledged RTS protocol version: v${version}. Updating internal tracking.`);
            await this.updateStatus(`PROTOCOL VERSION NEGOTIATED (v${version}).`, "send_version");
            return;
        }
        
        if (setupMsgType === 0x04 && dataPayload.length >= 2) {
            const version = dataPayload[0];
            const cladTag = dataPayload[1];
            const cladData = dataPayload.slice(2);
            if (cladTag === 0x01 && cladData.length >= 32) {
                this.robotPublicKey = cladData.slice(0, 32);
                if (!this.clientKeyPair) this.clientKeyPair = window.sodium.crypto_kx_keypair();
                const connRes = new Uint8Array(36);
                connRes[0] = 0x04;
                connRes[1] = version;
                connRes[2] = 0x02;
                connRes[3] = 0x00;
                connRes.set(this.clientKeyPair.publicKey, 4);
                await this.sendFramedPayload(this.writeChar, connRes);
            } else if (cladTag === 0x03 && cladData.length >= 48) {
                this.toRobotNonce = cladData.slice(0, 24);
                this.toDeviceNonce = cladData.slice(24, 48);
                await this.updateStatus("SUCCESS! CHECK VECTOR SCREEN FOR PIN.", "key_received");
                document.getElementById('pin-entry-section').style.display = 'block';
            }
        }
    }

    async submitPin() {
        const cleanPin = document.getElementById('vector-pin-input').value.replace(/\D/g, '');
        if (cleanPin.length !== 6) return;
        document.getElementById('pin-entry-section').style.display = 'none';
        try {
            await window.sodium.ready;
            const sodium = window.sodium;
            const sessionKeys = sodium.crypto_kx_client_session_keys(
                this.clientKeyPair.publicKey,
                this.clientKeyPair.privateKey,
                this.robotPublicKey
            );
            const response = await fetch('/api/vector/ble/hash_pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pin: cleanPin,
                    sharedRx: sodium.to_hex(sessionKeys.sharedRx),
                    sharedTx: sodium.to_hex(sessionKeys.sharedTx)
                })
            });
            if (!response.ok) {
                const body = await response.text();
                throw new Error(`API Error: ${response.status} ${body}`);
            }
            const hashData = await response.json();
            this.rxKey = sodium.from_hex(hashData.hashedRx);
            this.txKey = sodium.from_hex(hashData.hashedTx);
            if (!this.nonceAckSent) {
                await this.sendFramedPayload(this.writeChar, new Uint8Array([0x04, this.rtsVersion, 0x12, 0x03]));
                this.nonceAckSent = true;
                this.isSecureChannel = true;
                await this.updateStatus("KEYS DERIVED. AWAITING ENCRYPTED CHALLENGE...", "secret_derived");
            }
        } catch (error) {
            if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', `Server crypto failure: ${error.message}`);
            await this.updateStatus(`CRYPTO FAILURE: ${error.message}`, "error_general");
        }
    }

    async handleIncomingPacket(event) {
        const dataView = event.target.value;
        const data = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
        
        if (data.length === 0) return;
        
        if (window.appLogger) window.appLogger.log('DEBUG', 'BLE_RX_CHUNK', `Raw incoming chunk: ${this.bufToHex(data)}`);
        
        const header = data[0];
        const multipartState = header >> 6;
        const isEncryptedHeader = (header & 0x20) !== 0;
        const payloadSize = header & 0x1F;
        const chunk = data.slice(1, 1 + payloadSize);
        
        if (multipartState === 3) {
            this.multipartBuffer = new Uint8Array(0); 
            await this.processPayload(chunk, isEncryptedHeader);
        } else if (multipartState === 2) {
            this.multipartBuffer = chunk; 
            this.isReceivingEncrypted = isEncryptedHeader;
        } else if (multipartState === 0) {
            const newBuffer = new Uint8Array(this.multipartBuffer.length + chunk.length);
            newBuffer.set(this.multipartBuffer, 0);
            newBuffer.set(chunk, this.multipartBuffer.length);
            this.multipartBuffer = newBuffer;
        } else if (multipartState === 1) {
            const newBuffer = new Uint8Array(this.multipartBuffer.length + chunk.length);
            newBuffer.set(this.multipartBuffer, 0);
            newBuffer.set(chunk, this.multipartBuffer.length);
            this.multipartBuffer = newBuffer;
            await this.processPayload(this.multipartBuffer, this.isReceivingEncrypted);
            this.multipartBuffer = new Uint8Array(0); 
        }
    }

    async startPairing() {
        this.multipartBuffer = new Uint8Array(0);
        this.isReceivingEncrypted = false;
        this.isSecureChannel = false;
        this.nonceAckSent = false;
        this.pendingChallenge = null;
        this.clientKeyPair = null;
        this.robotPublicKey = null;
        this.toRobotNonce = null;
        this.toDeviceNonce = null;
        this.rxKey = null;
        this.txKey = null;
        this.botInfo = null;
        this.botIp = null;
        this.rtsVersion = 5;

        try {
            await window.sodium.ready;
            await this.updateStatus("SCANNING...", "scan_start");
            
            if (this.device && this.device.gatt && this.device.gatt.connected) {
                if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'Clearing previous GATT session...');
                this.device.gatt.disconnect();
                await new Promise(r => setTimeout(r, 500));
            }

            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [this.VECTOR_SERVICE_UUID]
            });
            
            this.device.removeEventListener('gattserverdisconnected', this.boundHandleDisconnect);
            this.device.addEventListener('gattserverdisconnected', this.boundHandleDisconnect);

            if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `Device selected: ${this.device.name || 'Unknown'}`);
            await this.updateStatus(`CONNECTING TO ${this.device.name || 'VECTOR'}...`, "device_selected");

            let server = null;
            let isConnected = false;
            
            for (let i = 0; i < 3; i++) {
                try {
                    server = await this.device.gatt.connect();
                    if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', `GATT Server connected (Attempt ${i + 1}).`);
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    if (this.device.gatt.connected) {
                        isConnected = true;
                        break;
                    } else {
                        if (window.appLogger) window.appLogger.log('WARN', 'LOCAL', 'Connection unstable. GATT disconnected.');
                    }
                } catch (e) {
                    if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', `Connection attempt ${i + 1} failed: ${e.message}`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (!isConnected || !server) {
                throw new Error("GATT connection failed after 3 attempts.");
            }

            await new Promise(resolve => setTimeout(resolve, 500));

            await this.updateStatus("ESTABLISHING RTS SESSION...", "connect_attempt");
            
            const service = await server.getPrimaryService(this.VECTOR_SERVICE_UUID);
            this.writeChar = await service.getCharacteristic(this.VECTOR_WRITE_UUID);
            this.notifyChar = await service.getCharacteristic(this.VECTOR_NOTIFY_UUID);
            
            if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'RTS characteristics discovered.');
            
            this.notifyChar.removeEventListener('characteristicvaluechanged', this.boundHandleIncomingPacket);
            this.notifyChar.addEventListener('characteristicvaluechanged', this.boundHandleIncomingPacket);
            await this.notifyChar.startNotifications();
            
            if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'Notifications enabled. Stabilising BLE channel (500ms)...');
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            if (window.appLogger) window.appLogger.log('INFO', 'LOCAL', 'Initiating handshake with requested version v5...');
            const handshakeReq = new Uint8Array([0x01, 0x05, 0x00, 0x00, 0x00]);
            await this.sendFramedPayload(this.writeChar, handshakeReq);
            
            await this.updateStatus("AWAITING ROBOT HANDSHAKE ACK...", "notifications_active");
        } catch (error) {
            if (window.appLogger) window.appLogger.log('ERROR', 'LOCAL', `Pairing failed: ${error.message}`);
            await this.updateStatus(`ERR: ${error.message}`, "connect_fail");
            if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
        }
    }
}
window.VectorSetup = VectorSetup;