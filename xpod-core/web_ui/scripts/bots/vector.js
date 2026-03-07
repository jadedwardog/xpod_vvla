class VectorSetup {
    constructor() {
        console.log("[xpod] VectorSetup Module Loaded - Handshake Revision (v4)");
        this.VECTOR_WRITE_UUID = '7d2a4bda-d29b-4152-b725-2491478c5cd7';
        this.VECTOR_NOTIFY_UUID = '30619f2d-0f54-41bd-a65a-7588d8c85b45';
        this.VECTOR_SERVICE_UUID = '0000fee3-0000-1000-8000-00805f9b34fb';
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
    }

    bufToHex(buf) {
        return Array.from(new Uint8Array(buf))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
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
                <div style="border-top: 1px solid rgba(0,255,0,0.3); padding-top: 10px;">
                    <button id="cloud-auth-btn" class="neon-btn" style="width: 100%;">AUTHORISE CLOUD SESSION</button>
                </div>
            </div>

            <p id="vector-setup-status" style="color: #00ff00; font-size: 0.9rem; margin-top: 15px;"></p>
            <div style="margin-top: 20px;">
                <div style="font-weight: bold; margin-bottom: 5px; color: #fff; text-shadow: 0 0 5px #fff;">DIAGNOSTIC FEED</div>
                <div id="vector-diagnostic-feed" style="height: 250px; overflow-y: auto;"></div>
            </div>
            <button class="neon-btn" style="margin-top: 20px; border-color: #ff003c; color: #ff003c;" onclick="document.getElementById('dynamic-setup-container').style.display='none'; document.getElementById('eyes-display').style.opacity='1'; document.querySelector('.bottom-status .title').innerText='DASHBOARD';">ABORT</button>
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
        document.getElementById('cloud-auth-btn').addEventListener('click', () => this.cloudAuthorize());
    }

    async sendFramedPayload(writeChar, payload) {
        const totalLen = payload.length;
        if (totalLen <= 19) {
            const header = 0xC0 | totalLen;
            const chunk = new Uint8Array(1 + totalLen);
            chunk[0] = header;
            chunk.set(payload, 1);
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
            await writeChar.writeValueWithoutResponse(chunk);
            offset += chunkLen;
            isFirst = false;
            if (!isLast) await new Promise(r => setTimeout(r, 100));
        }
    }

    async sendEncrypted(payload) {
        try {
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
            window.appLogger.log('ERROR', 'LOCAL', `Encryption failed: ${error.message}`);
        }
    }

    async requestStatus() {
        window.appLogger.log('INFO', 'LOCAL', 'Requesting robot status...');
        await this.sendEncrypted(new Uint8Array([0x04, 0x05, 0x0A]));
    }

    async startWifiScan() {
        window.appLogger.log('INFO', 'LOCAL', 'Triggering Wi-Fi scan...');
        await this.sendEncrypted(new Uint8Array([0x04, 0x05, 0x0C]));
    }

    async rebootRobot() {
        window.appLogger.log('INFO', 'LOCAL', 'Sending Force Restart command (Tag 0x11)...');
        await this.sendEncrypted(new Uint8Array([0x04, 0x05, 0x11]));
    }

    async connectToWifi(targetNetwork = null, targetPassword = null) {
        const ssid = targetNetwork || document.getElementById('wifi-network-select').value;
        const password = targetPassword || document.getElementById('wifi-password-input').value;
        const statusText = document.getElementById('vector-setup-status');
        
        const net = this.networks.find(n => n.ssid === ssid);
        if (!net) {
            window.appLogger.log('ERROR', 'LOCAL', `Target network metadata (${ssid}) not found.`);
            return;
        }

        window.appLogger.log('INFO', 'LOCAL', `Initiating connection to ${ssid}...`);
        if (statusText) statusText.innerText = "> CONNECTING TO WI-FI...";

        this.lastUsedWifi = { ssid, password };

        const ssidHexBytes = new TextEncoder().encode(net.ssidHex);
        const passBytes = new TextEncoder().encode(password);

        const payload = new Uint8Array(3 + 1 + ssidHexBytes.length + 1 + passBytes.length + 1 + 1 + 1);
        payload[0] = 0x04;
        payload[1] = 0x05;
        payload[2] = 0x06;
        
        let pos = 3;
        payload[pos++] = ssidHexBytes.length;
        payload.set(ssidHexBytes, pos);
        pos += ssidHexBytes.length;
        
        payload[pos++] = passBytes.length;
        payload.set(passBytes, pos);
        pos += passBytes.length;
        
        payload[pos++] = 15; 
        payload[pos++] = net.authType;
        payload[pos++] = net.hidden ? 1 : 0;

        await this.sendEncrypted(payload);
    }

    async triggerOtaUpdate() {
        const url = document.getElementById('ota-url-input').value;
        if (!url) {
            window.appLogger.log('WARN', 'LOCAL', 'OTA URL cannot be empty.');
            return;
        }
        window.appLogger.log('INFO', 'LOCAL', `Requesting OTA update from: ${url}`);
        
        const urlBytes = new TextEncoder().encode(url);
        const payload = new Uint8Array(3 + 1 + urlBytes.length);
        payload[0] = 0x04;
        payload[1] = 0x05;
        payload[2] = 0x0E;
        payload[3] = urlBytes.length;
        payload.set(urlBytes, 4);

        await this.sendEncrypted(payload);
        
        document.getElementById('ota-progress-wrap').style.display = 'block';
        document.getElementById('ota-restart-btn').style.display = 'none';
    }

    async cloudAuthorize() {
        const statusText = document.getElementById('vector-setup-status');
        
        // Safety check: Is the robot connected to Wi-Fi?
        if (!this.botInfo || (this.botInfo.wifiState !== 1)) {
            window.appLogger.log('WARN', 'LOCAL', 'Robot is offline. Attempting Wi-Fi reconnection before authorisation.');
            if (this.lastUsedWifi) {
                await this.connectToWifi(this.lastUsedWifi.ssid, this.lastUsedWifi.password);
                // Authorisation will be retried automatically upon successful connection response
                return;
            } else {
                if (statusText) statusText.innerText = "> ERR: ROBOT OFFLINE. CONNECT WI-FI FIRST.";
                return;
            }
        }

        const sessionToken = "xpod_token";
        const clientName = "Web-Setup";
        const appId = "com.anki.vector";
        
        const encoder = new TextEncoder();
        const tokenBytes = encoder.encode(sessionToken);
        const nameBytes = encoder.encode(clientName);
        const appBytes = encoder.encode(appId);

        const totalLength = 3 + 2 + tokenBytes.length + 1 + nameBytes.length + 1 + appBytes.length;
        const payload = new Uint8Array(totalLength);

        let offset = 0;
        payload.set([0x04, 0x05, 0x1D], offset);
        offset += 3;

        // sessionToken (uint16 Little-Endian length prefix)
        payload[offset] = tokenBytes.length & 0xFF;
        payload[offset + 1] = (tokenBytes.length >> 8) & 0xFF;
        offset += 2;
        payload.set(tokenBytes, offset);
        offset += tokenBytes.length;

        // clientName (uint8 length prefix)
        payload[offset] = nameBytes.length;
        offset += 1;
        payload.set(nameBytes, offset);
        offset += nameBytes.length;

        // appId (uint8 length prefix)
        payload[offset] = appBytes.length;
        offset += 1;
        payload.set(appBytes, offset);

        window.appLogger.log('INFO', 'LOCAL', `Submitting Cloud Authorisation Request [V5] with token: ${sessionToken}`);
        await this.sendEncrypted(payload);
    }

    parseWifiScan(data) {
        const status = data[0];
        const count = data[1];
        window.appLogger.log('INFO', 'LOCAL', `Scan Result - Status: ${status}, Networks found: ${count}`);
        
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

            window.appLogger.log('INFO', 'LOCAL', `Network ${i + 1}: ${ssid} [Signal: ${signal}, Auth: ${authType}, Hidden: ${hidden}, Provisioned: ${provisioned}]`);
            
            offset += 5 + ssidLen;
        }

        if (wifiSection) wifiSection.style.display = 'block';
    }

    parseStatusResponse(data) {
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

        const statusText = document.getElementById('vector-setup-status');
        if (statusText) {
            statusText.innerText = `> STATUS LOADED: ${esn}`;
        }

        window.appLogger.log('INFO', 'LOCAL', `Bot Status Parsed -> ESN: ${esn}, OS: ${osVersion}, WiFi: ${wifiState === 1 ? 'ONLINE' : 'OFFLINE'}`);
        
        const nextSteps = document.getElementById('vector-next-steps');
        if (nextSteps) nextSteps.style.display = 'block';
    }

    handleOtaProgress(data) {
        const statusCode = data[0];
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        
        const current = view.getUint32(1, true); 
        const total = view.getUint32(9, true);

        const progressBar = document.getElementById('ota-progress-bar');
        const progressText = document.getElementById('ota-progress-text');
        const statusText = document.getElementById('vector-setup-status');
        const restartBtn = document.getElementById('ota-restart-btn');

        if (statusCode === 0x02) { // IN_PROGRESS
            const percentage = total > 0 ? Math.min(100, Math.floor((current / total) * 100)) : 0;
            if (progressBar) progressBar.style.width = `${percentage}%`;
            if (progressText) progressText.innerText = `${percentage}% (Processing)`;
            if (statusText && current === 0) statusText.innerText = "> OTA: TRANSITIONING TO FLASH PHASE...";
        } else if (statusCode === 0x03) { // COMPLETED
            if (progressBar) progressBar.style.width = `100%`;
            if (progressText) progressText.innerText = `OTA COMPLETE`;
            if (statusText) statusText.innerText = "> OTA INSTALLATION SUCCESSFUL.";
            if (restartBtn) restartBtn.style.display = 'block';
        } else if (statusCode === 0x04) { // REBOOTING
            if (statusText) statusText.innerText = "> ROBOT REBOOTING. CONNECTION WILL DROP.";
            window.appLogger.log('WARN', 'LOCAL', 'Robot issued reboot command after OTA.');
        } else if (statusCode === 0x05) { // ERROR
            if (statusText) statusText.innerText = "> OTA FAILED. CHECK LOGS.";
            window.appLogger.log('ERROR', 'LOCAL', 'OTA error status received from robot.');
        }
    }

    async processSecurePayload(encryptedPayload) {
        try {
            const sodium = window.sodium;
            const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
                null,
                encryptedPayload,
                null,
                this.toDeviceNonce,
                this.rxKey
            );
            this.pendingChallenge = null;
            sodium.increment(this.toDeviceNonce);
            window.appLogger.log('INFO', 'FROM ROBOT (SECURE)', `Decrypted plaintext: ${this.bufToHex(plaintext)}`);

            if (plaintext.length >= 3 && plaintext[0] === 0x04) {
                const cladTag = plaintext[2];
                const statusText = document.getElementById('vector-setup-status');

                if (cladTag === 0x04) {
                    const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
                    const challengeNum = view.getUint32(3, true);
                    const responsePlaintext = new Uint8Array(plaintext);
                    const responseView = new DataView(responsePlaintext.buffer, responsePlaintext.byteOffset, responsePlaintext.byteLength);
                    responseView.setUint32(3, challengeNum + 1, true);
                    await this.sendEncrypted(responsePlaintext);
                    if (statusText) statusText.innerText = "> CHALLENGE ANSWERED. AWAITING CONFIRMATION...";
                } else if (cladTag === 0x05) {
                    if (statusText) statusText.innerText = "> SECURE PAIRING COMPLETE!";
                    document.getElementById('vector-control-panel').style.display = 'block';
                    await this.sendEncrypted(new Uint8Array([0x04, 0x05, 0x12, 0x05]));
                    this.requestStatus(); 
                } else if (cladTag === 0x07) {
                    const ssidLen = plaintext[3];
                    const connectResult = plaintext[5 + ssidLen];
                    let resultMsg = "FAILURE";
                    if (connectResult === 0x00) resultMsg = "SUCCESS";
                    else if (connectResult === 0x02) resultMsg = "INVALID PASSWORD";
                    window.appLogger.log('INFO', 'FROM ROBOT (SECURE)', `Wi-Fi connection result: ${resultMsg}`);
                    if (statusText) statusText.innerText = `> WI-FI: ${resultMsg}`;
                    if (connectResult === 0x00) {
                        this.requestStatus();
                        // If we were reconnecting specifically for cloud auth, trigger it now
                        if (this.lastUsedWifi) setTimeout(() => this.cloudAuthorize(), 2000);
                    }
                } else if (cladTag === 0x0B) {
                    this.parseStatusResponse(plaintext.slice(3));
                } else if (cladTag === 0x0D) {
                    this.parseWifiScan(plaintext.slice(3));
                } else if (cladTag === 0x0F) {
                    this.handleOtaProgress(plaintext.slice(3));
                } else if (cladTag === 0x1E) { // CloudSessionResponse
                    const success = plaintext[3] === 0x01;
                    const statusCode = plaintext[4];
                    const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
                    const guidLen = view.getUint16(5, true);
                    const guid = new TextDecoder().decode(plaintext.slice(7, 7 + guidLen));
                    
                    window.appLogger.log('INFO', 'FROM ROBOT (SECURE)', `Cloud Auth Result: ${success ? 'SUCCESS' : 'FAILED'} (Status: ${statusCode})`);
                    if (success) {
                        window.appLogger.log('INFO', 'LOCAL', `Authorised GUID: ${guid}`);
                        if (statusText) statusText.innerText = "> ACCOUNT PAIRED SUCCESSFULLY!";
                        this.requestStatus(); // Refresh auth UI
                    } else {
                        if (statusText) statusText.innerText = `> CLOUD AUTH FAILED (CODE: ${statusCode})`;
                    }
                }
            }
        } catch (error) {
            window.appLogger.log('ERROR', 'LOCAL', `Failed to decrypt secure payload: ${error.message}`);
            this.isSecureChannel = false;
            this.isReceivingEncrypted = false;
            this.nonceAckSent = false;
            document.getElementById('pin-entry-section').style.display = 'block';
        }
    }

    async processPayload(payload, isEncryptedHeaderFlag) {
        const isActuallyEncrypted = (isEncryptedHeaderFlag || this.isSecureChannel) && (payload.length >= 16);
        if (isActuallyEncrypted) {
            await this.processSecurePayload(payload);
            return;
        }
        const setupMsgType = payload[0];
        const dataPayload = payload.slice(1);
        if (setupMsgType === 0x01 && dataPayload.length === 4) {
            const version = new DataView(dataPayload.buffer, dataPayload.byteOffset, dataPayload.byteLength).getUint32(0, true);
            if (version >= 4) {
                const ackPayload = new Uint8Array(5);
                ackPayload[0] = 0x01;
                ackPayload.set(dataPayload, 1);
                await this.sendFramedPayload(this.writeChar, ackPayload);
            }
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
                const statusText = document.getElementById('vector-setup-status');
                if (statusText) statusText.innerText = "> SUCCESS! CHECK VECTOR SCREEN FOR PIN.";
                document.getElementById('pin-entry-section').style.display = 'block';
            }
        }
    }

    async submitPin() {
        const cleanPin = document.getElementById('vector-pin-input').value.replace(/\D/g, '');
        const statusText = document.getElementById('vector-setup-status');
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
                await this.sendFramedPayload(this.writeChar, new Uint8Array([0x04, 0x05, 0x12, 0x03]));
                this.nonceAckSent = true;
                this.isSecureChannel = true;
                if (statusText) statusText.innerText = "> KEYS DERIVED. AWAITING ENCRYPTED CHALLENGE...";
            }
        } catch (error) {
            window.appLogger.log('ERROR', 'LOCAL', `Server crypto failure: ${error.message}`);
        }
    }

    async handleIncomingPacket(event) {
        const data = new Uint8Array(event.target.value.buffer);
        if (data.length === 0) return;
        const header = data[0];
        const multipartState = header >> 6;
        const isEncryptedHeader = (header & 0x20) !== 0;
        const payloadSize = header & 0x1F;
        const chunk = data.slice(1, 1 + payloadSize);
        if (multipartState === 3) {
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
        const statusText = document.getElementById('vector-setup-status');
        try {
            await window.sodium.ready;
            if (statusText) statusText.innerText = "> SCANNING...";
            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [this.VECTOR_SERVICE_UUID]
            });
            
            window.appLogger.log('INFO', 'LOCAL', `Device selected: ${this.device.name || 'Unknown'}`);
            if (statusText) statusText.innerText = `> CONNECTING TO ${this.device.name || 'VECTOR'}...`;

            let server = null;
            let isConnected = false;
            
            for (let i = 0; i < 3; i++) {
                try {
                    server = await this.device.gatt.connect();
                    window.appLogger.log('INFO', 'LOCAL', `GATT Server connected (Attempt ${i + 1}).`);
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    if (this.device.gatt.connected) {
                        isConnected = true;
                        break;
                    } else {
                        window.appLogger.log('WARN', 'LOCAL', 'Connection unstable. GATT disconnected.');
                    }
                } catch (e) {
                    window.appLogger.log('ERROR', 'LOCAL', `Connection attempt ${i + 1} failed: ${e.message}`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (!isConnected || !server) {
                throw new Error("GATT connection failed after 3 attempts.");
            }

            this.device.addEventListener('gattserverdisconnected', () => {
                window.appLogger.log('CRITICAL', 'FROM ROBOT', 'Robot severed GATT connection.');
                if (statusText) statusText.innerText = "> OFFLINE. PLEASE RE-ENTER PAIRING MODE.";
            });

            if (statusText) statusText.innerText = "> ESTABLISHING RTS SESSION...";
            
            const service = await server.getPrimaryService(this.VECTOR_SERVICE_UUID);
            this.writeChar = await service.getCharacteristic(this.VECTOR_WRITE_UUID);
            this.notifyChar = await service.getCharacteristic(this.VECTOR_NOTIFY_UUID);
            
            window.appLogger.log('INFO', 'LOCAL', 'RTS characteristics discovered.');
            
            await this.notifyChar.startNotifications();
            this.notifyChar.addEventListener('characteristicvaluechanged', (e) => this.handleIncomingPacket(e));
            
            window.appLogger.log('INFO', 'LOCAL', 'Notifications enabled. Listening for handshake.');
            if (statusText) statusText.innerText = "> AWAITING ROBOT HANDSHAKE...";
        } catch (error) {
            window.appLogger.log('ERROR', 'LOCAL', `Pairing failed: ${error.message}`);
            if (statusText) statusText.innerText = `> ERR: ${error.message}`;
            if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
        }
    }
}
window.VectorSetup = VectorSetup;