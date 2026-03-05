class VectorSetup {
    constructor() {
        this.VECTOR_WRITE_UUID = '7d2a4bda-d29b-4152-b725-2491478c5cd7';
        this.VECTOR_NOTIFY_UUID = '30619f2d-0f54-41bd-a65a-7588d8c85b45';
        this.VECTOR_SERVICE_UUID = '0000fee3-0000-1000-8000-00805f9b34fb';
        
        this.multipartBuffer = new Uint8Array(0);
        this.isReceivingEncrypted = false;
        
        this.clientKeyPair = null;
        this.robotPublicKey = null;
        
        this.toRobotNonce = null;
        this.toDeviceNonce = null;
        this.rxKey = null;
        this.txKey = null;

        this.device = null;
        this.writeChar = null;
        this.notifyChar = null;
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

        const pairBtn = document.getElementById('vector-ble-pair-btn');
        if (pairBtn) {
            pairBtn.addEventListener('click', () => this.startPairing());
        }

        const submitPinBtn = document.getElementById('submit-pin-btn');
        if (submitPinBtn) {
            submitPinBtn.addEventListener('click', () => this.submitPin());
        }
    }

    async sendFramedPayload(writeChar, payload) {
        const totalLen = payload.length;

        if (totalLen <= 19) {
            const header = 0xC0 | totalLen;
            const chunk = new Uint8Array(1 + totalLen);
            chunk[0] = header;
            chunk.set(payload, 1);
            window.appLogger.log('INFO', 'send_single', 'Sending solo packet', chunk);
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

            window.appLogger.log('INFO', 'send_chunk', 'Sending multipart packet', chunk);
            await writeChar.writeValueWithoutResponse(chunk);
            
            offset += chunkLen;
            isFirst = false;

            if (!isLast) await new Promise(r => setTimeout(r, 40));
        }
    }

    async sendEncryptedMultipart(ciphertext) {
        const p1 = new Uint8Array(20);
        p1[0] = 0xB3;
        p1.set(ciphertext.slice(0, 19), 1);
        window.appLogger.log('INFO', 'send_chunk', 'Sending encrypted START packet (0xB3)', p1);
        await this.writeChar.writeValueWithoutResponse(p1);

        await new Promise(r => setTimeout(r, 40));

        const p2 = new Uint8Array(5);
        p2[0] = 0x64;
        p2.set(ciphertext.slice(19), 1);
        window.appLogger.log('INFO', 'send_chunk', 'Sending encrypted END packet (0x64)', p2);
        await this.writeChar.writeValueWithoutResponse(p2);
    }

    async answerChallenge(encryptedPayload) {
        try {
            const sodium = window.sodium;
            const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
                null,
                encryptedPayload,
                null,
                this.toDeviceNonce,
                this.rxKey
            );
            sodium.increment(this.toDeviceNonce);

            window.appLogger.log('INFO', 'msg_received', 'Decrypted challenge plaintext', plaintext);

            const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
            const challengeNum = view.getUint32(3, true);
            window.appLogger.log('INFO', 'msg_received', `Challenge number: ${challengeNum}. Incrementing...`);

            const responsePlaintext = new Uint8Array(plaintext);
            const responseView = new DataView(responsePlaintext.buffer, responsePlaintext.byteOffset, responsePlaintext.byteLength);
            responseView.setUint32(3, challengeNum + 1, true);

            const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
                responsePlaintext,
                null,
                null,
                this.toRobotNonce,
                this.txKey
            );
            sodium.increment(this.toRobotNonce);

            window.appLogger.log('INFO', 'send_chunk', 'Sending answered challenge response...');
            await this.sendEncryptedMultipart(ciphertext);
            
            const statusText = document.getElementById('vector-setup-status');
            if (statusText) statusText.innerText = "> CHALLENGE ANSWERED. AWAITING CONFIRMATION...";
        } catch (error) {
            window.appLogger.log('ERROR', 'error_general', `Failed to decrypt/answer challenge: ${error.message}`);
        }
    }

    async processPayload(payload, isEncrypted) {
        if (isEncrypted) {
            window.appLogger.log('INFO', 'msg_received', 'Encrypted payload recognized. Routing to decryptor.');
            await this.answerChallenge(payload);
            return;
        }

        const setupMsgType = payload[0];
        const dataPayload = payload.slice(1);
        const statusText = document.getElementById('vector-setup-status');

        window.appLogger.log('INFO', 'msg_received', `Processing Payload. SETUP MSG TYPE: 0x${setupMsgType.toString(16).padStart(2, '0')} | LEN: ${payload.length}`, payload);

        if (setupMsgType === 0x01 && dataPayload.length === 4) {
            const version = new DataView(dataPayload.buffer, dataPayload.byteOffset, dataPayload.byteLength).getUint32(0, true);
            window.appLogger.log('INFO', 'handshake_accepted', `Handshake initiated by Vector. Version: ${version}`, dataPayload);
            
            if (version >= 4) {
                if (statusText) statusText.innerText = "> HANDSHAKE RECEIVED. SENDING ACKNOWLEDGEMENT...";
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
            
            window.appLogger.log('INFO', 'clad_received', `RTS Channel. Version: ${version} | CLAD TAG: 0x${cladTag.toString(16).padStart(2, '0')}`, cladData);

            if (cladTag === 0x01 && cladData.length >= 32) {
                this.robotPublicKey = cladData.slice(0, 32);
                if (statusText) statusText.innerText = "> GENERATING CLIENT KEYS...";
                if (!this.clientKeyPair) this.clientKeyPair = window.sodium.crypto_kx_keypair();
                
                const connRes = new Uint8Array(36);
                connRes[0] = 0x04;
                connRes[1] = version;
                connRes[2] = 0x02;
                connRes[3] = 0x00;
                connRes.set(this.clientKeyPair.publicKey, 4);
                
                await this.sendFramedPayload(this.writeChar, connRes);
                return;
            } 
            
            if (cladTag === 0x03 && cladData.length >= 48) {
                window.appLogger.log('INFO', 'nonces_received', 'Received Nonces from Vector.');
                this.toRobotNonce = cladData.slice(0, 24);
                this.toDeviceNonce = cladData.slice(24, 48);
                
                if (statusText) statusText.innerText = "> SUCCESS! CHECK VECTOR SCREEN FOR PIN.";
                const pinSection = document.getElementById('pin-entry-section');
                if (pinSection) pinSection.style.display = 'block';
                return;
            }

            if (cladTag === 0x15) {
                window.appLogger.log('WARN', 'pairing_cancelled', 'Vector explicitly cancelled pairing.');
                return;
            }
            
            if (cladTag === 0x10) {
                window.appLogger.log('WARN', 'error_general', 'Received Tag 0x10 (Aborted).', cladData);
                return;
            }

            if (cladTag > 0x04 && cladTag !== 0x10 && cladTag !== 0x15) {
                window.appLogger.log('INFO', 'handshake_accepted', `Pairing confirmed! Tag 0x${cladTag.toString(16)}`, cladData);
                if (statusText) statusText.innerText = "> SECURE PAIRING COMPLETE!";
            }
        }
    }

    async submitPin() {
        const pinInput = document.getElementById('vector-pin-input').value.trim();
        const statusText = document.getElementById('vector-setup-status');
        
        if (!pinInput || pinInput.length !== 6) {
            window.appLogger.log('WARN', 'error_general', 'Invalid PIN. Must be exactly 6 digits.');
            if (statusText) statusText.innerText = "> ERR: INVALID PIN FORMAT";
            return;
        }

        window.appLogger.log('INFO', 'send_chunk', `PIN entered: ${pinInput}. Deriving session keys...`);
        if (statusText) statusText.innerText = "> DERIVING ENCRYPTION KEYS...";

        document.getElementById('pin-entry-section').style.display = 'none';

        try {
            await window.sodium.ready;
            const sodium = window.sodium;
            
            const sessionKeys = sodium.crypto_kx_client_session_keys(
                this.clientKeyPair.publicKey,
                this.clientKeyPair.privateKey,
                this.robotPublicKey
            );
            
            this.rxKey = sodium.crypto_generichash(32, pinInput, sessionKeys.sharedRx);
            this.txKey = sodium.crypto_generichash(32, pinInput, sessionKeys.sharedTx);
            
            window.appLogger.log('INFO', 'secret_derived', 'Session keys derived using Libsodium Blake2b hash.');
            
            const ackData = new Uint8Array([0x04, 0x05, 0x12, 0x03]);
            window.appLogger.log('INFO', 'send_single', 'SEND RtsAck for Nonces (Tag 0x12)', ackData);
            await this.sendFramedPayload(this.writeChar, ackData);
            
            if (statusText) statusText.innerText = "> KEYS DERIVED. AWAITING ENCRYPTED CHALLENGE...";
        } catch (error) {
            window.appLogger.log('ERROR', 'error_general', `Key derivation failed: ${error.message}`);
            if (statusText) statusText.innerText = "> ERR: KEY DERIVATION FAILED";
        }
    }

    async handleIncomingPacket(event) {
        const data = new Uint8Array(event.target.value.buffer);
        if (data.length === 0) return;

        const header = data[0];
        const multipartState = header >> 6;
        const isEncrypted = (header & 0x20) !== 0;
        const payloadSize = header & 0x1F;

        const chunk = data.slice(1, 1 + payloadSize);

        if (multipartState === 3) {
            await this.processPayload(chunk, isEncrypted);
        } 
        else if (multipartState === 2) {
            this.multipartBuffer = chunk;
            this.isReceivingEncrypted = isEncrypted;
            window.appLogger.log('INFO', 'msg_received', `Multipart START. Encrypted: ${isEncrypted}. Header: 0x${header.toString(16)}`);
        } 
        else if (multipartState === 0) {
            const newBuffer = new Uint8Array(this.multipartBuffer.length + chunk.length);
            newBuffer.set(this.multipartBuffer, 0);
            newBuffer.set(chunk, this.multipartBuffer.length);
            this.multipartBuffer = newBuffer;
        } 
        else if (multipartState === 1) {
            const newBuffer = new Uint8Array(this.multipartBuffer.length + chunk.length);
            newBuffer.set(this.multipartBuffer, 0);
            newBuffer.set(chunk, this.multipartBuffer.length);
            this.multipartBuffer = newBuffer;

            window.appLogger.log('INFO', 'msg_received', `Multipart END. Processing 23-byte payload. Encryption: ${this.isReceivingEncrypted}`);
            await this.processPayload(this.multipartBuffer, this.isReceivingEncrypted);
            this.multipartBuffer = new Uint8Array(0); 
        }
    }

    async startPairing() {
        const statusText = document.getElementById('vector-setup-status');
        this.rxBuffer = new Uint8Array(0);
        this.multipartBuffer = new Uint8Array(0);
        this.clientKeyPair = null;
        this.robotPublicKey = null;
        
        try {
            if (!window.sodium) throw new Error("Libsodium-wrappers (sodium) cryptography library not loaded.");
            await window.sodium.ready;

            window.appLogger.log('INFO', 'scan_start', 'Starting device scan');
            if (statusText) statusText.innerText = "> SCANNING...";
            
            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [this.VECTOR_SERVICE_UUID]
            });

            window.appLogger.log('INFO', 'device_selected', `Device selected: ${this.device.name || 'Unknown'}`);
            if (statusText) statusText.innerText = `> CONNECTING TO ${this.device.name || 'VECTOR'}...`;
            
            let server = null;
            let isConnected = false;
            
            for (let i = 0; i < 3; i++) {
                try {
                    server = await this.device.gatt.connect();
                    window.appLogger.log('INFO', 'connect_attempt', `GATT Server connected (Attempt ${i + 1}). Stabilising...`);
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    
                    if (this.device.gatt.connected) {
                        isConnected = true;
                        break;
                    } else {
                        window.appLogger.log('WARN', 'connect_drop', 'Connection dropped during stabilisation.');
                    }
                } catch (e) {
                    window.appLogger.log('ERROR', 'connect_fail', `Connection attempt ${i + 1} failed.`, { error: e.message });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            if (!isConnected || !server) {
                throw new Error("Failed to establish a stable GATT connection after multiple attempts.");
            }

            this.device.addEventListener('gattserverdisconnected', () => {
                window.appLogger.log('CRITICAL', 'disconnect', 'Vector disconnected from GATT.');
                if (statusText) statusText.innerText = "> OFFLINE. PLEASE RE-ENTER PAIRING MODE.";
            });
            
            if (statusText) statusText.innerText = "> ESTABLISHING RTS SESSION...";
            const service = await server.getPrimaryService(this.VECTOR_SERVICE_UUID);
            
            this.writeChar = await service.getCharacteristic(this.VECTOR_WRITE_UUID);
            this.notifyChar = await service.getCharacteristic(this.VECTOR_NOTIFY_UUID);
            window.appLogger.log('INFO', 'characteristics_found', 'Characteristics discovered. Subscribing...');
            
            await this.notifyChar.startNotifications();
            this.notifyChar.addEventListener('characteristicvaluechanged', (e) => this.handleIncomingPacket(e));
            
            window.appLogger.log('INFO', 'notifications_active', 'Notifications active. Listening for robot handshake.');
            if (statusText) statusText.innerText = "> AWAITING ROBOT HANDSHAKE...";

        } catch (error) {
            window.appLogger.log('ERROR', 'error_general', `Setup Failed: ${error.message}`);
            if (statusText) statusText.innerText = `> ERR: ${error.message}`;
            if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
        }
    }
}

window.VectorSetup = VectorSetup;