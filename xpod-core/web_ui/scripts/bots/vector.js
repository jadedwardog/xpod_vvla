class VectorSetup {
    constructor() {
        console.log("[xpod] VectorSetup Module Loaded - Cache Busted (v3)");
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
            window.appLogger.log('INFO', 'LOCAL', 'Vector Setup module initialised (Cache Busted v3)');
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
            chunk[0] = header;
            chunk.set(payload, 1);
            window.appLogger.log('INFO', 'TO ROBOT', `Single packet: ${this.bufToHex(chunk)}`);
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
            window.appLogger.log('INFO', 'TO ROBOT', `Multipart packet [M:${multipart}]: ${this.bufToHex(chunk)}`);
            await writeChar.writeValueWithoutResponse(chunk);
            offset += chunkLen;
            isFirst = false;
            if (!isLast) await new Promise(r => setTimeout(r, 100));
        }
    }

    async processSecurePayload(encryptedPayload) {
        try {
            const sodium = window.sodium;
            const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
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
                    window.appLogger.log('INFO', 'LOCAL', `Challenge number parsed: ${challengeNum}. Responding with ${challengeNum + 1}`);
                    const responsePlaintext = new Uint8Array(plaintext);
                    const responseView = new DataView(responsePlaintext.buffer, responsePlaintext.byteOffset, responsePlaintext.byteLength);
                    responseView.setUint32(3, challengeNum + 1, true);
                    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
                        responsePlaintext,
                        null,
                        this.toRobotNonce,
                        this.txKey
                    );
                    sodium.increment(this.toRobotNonce);
                    window.appLogger.log('INFO', 'TO ROBOT (SECURE)', `Sending challenge response ciphertext: ${this.bufToHex(ciphertext)}`);
                    await this.sendFramedPayload(this.writeChar, ciphertext);
                    if (statusText) statusText.innerText = "> CHALLENGE ANSWERED. AWAITING CONFIRMATION...";
                } else if (cladTag === 0x05) {
                    window.appLogger.log('INFO', 'FROM ROBOT (SECURE)', 'Secure pairing confirmation (Tag 0x05) received.');
                    if (statusText) statusText.innerText = "> SECURE PAIRING COMPLETE!";
                    const ackData = new Uint8Array([0x04, 0x05, 0x12, 0x05]);
                    const ackCiphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
                        ackData,
                        null,
                        this.toRobotNonce,
                        this.txKey
                    );
                    sodium.increment(this.toRobotNonce);
                    window.appLogger.log('INFO', 'TO ROBOT (SECURE)', `Sending final pairing ACK: ${this.bufToHex(ackCiphertext)}`);
                    await this.sendFramedPayload(this.writeChar, ackCiphertext);
                } else {
                    window.appLogger.log('WARN', 'FROM ROBOT (SECURE)', `Unknown secure CLAD tag detected: 0x${cladTag.toString(16)}`);
                }
            }
        } catch (error) {
            window.appLogger.log('ERROR', 'LOCAL', `Failed to decrypt secure payload: ${error.message}`);
            const statusText = document.getElementById('vector-setup-status');
            this.isSecureChannel = false;
            this.isReceivingEncrypted = false;
            this.nonceAckSent = false;
            this.pendingChallenge = null;
            if (statusText) statusText.innerText = "> DECRYPTION FAILED. INCORRECT PIN OR TIMEOUT.";
            const pinSection = document.getElementById('pin-entry-section');
            if (pinSection) pinSection.style.display = 'block';
            const pinInput = document.getElementById('vector-pin-input');
            if (pinInput) {
                pinInput.value = '';
                pinInput.focus();
            }
        }
    }

    async processPayload(payload, isEncryptedHeaderFlag) {
        const isActuallyEncrypted = (isEncryptedHeaderFlag || this.isSecureChannel) && (payload.length >= 16);
        if (isActuallyEncrypted) {
            window.appLogger.log('INFO', 'FROM ROBOT', `Encrypted payload received: ${this.bufToHex(payload)}`);
            await this.processSecurePayload(payload);
            return;
        }
        window.appLogger.log('INFO', 'FROM ROBOT', `Cleartext payload received: ${this.bufToHex(payload)}`);
        const setupMsgType = payload[0];
        const dataPayload = payload.slice(1);
        const statusText = document.getElementById('vector-setup-status');
        if (setupMsgType === 0x01 && dataPayload.length === 4) {
            this.isSecureChannel = false;
            this.isReceivingEncrypted = false;
            this.nonceAckSent = false;
            this.pendingChallenge = null;
            const version = new DataView(dataPayload.buffer, dataPayload.byteOffset, dataPayload.byteLength).getUint32(0, true);
            window.appLogger.log('INFO', 'LOCAL', `Robot initiated handshake. Protocol version: ${version}`);
            if (version >= 4) {
                if (statusText) statusText.innerText = "> HANDSHAKE RECEIVED. SENDING ACKNOWLEDGEMENT...";
                const ackPayload = new Uint8Array(5);
                ackPayload[0] = 0x01;
                ackPayload.set(dataPayload, 1);
                window.appLogger.log('INFO', 'TO ROBOT', `Sending handshake ACK: ${this.bufToHex(ackPayload)}`);
                await this.sendFramedPayload(this.writeChar, ackPayload);
            }
            return;
        }
        if (setupMsgType === 0x04 && dataPayload.length >= 2) {
            const version = dataPayload[0];
            const cladTag = dataPayload[1];
            const cladData = dataPayload.slice(2);
            window.appLogger.log('INFO', 'FROM ROBOT', `RTS Channel message. Tag: 0x${cladTag.toString(16).padStart(2, '0')}`);
            if (cladTag === 0x01 && cladData.length >= 32) {
                this.robotPublicKey = cladData.slice(0, 32);
                window.appLogger.log('INFO', 'LOCAL', `Robot public key extracted: ${this.bufToHex(this.robotPublicKey)}`);
                if (statusText) statusText.innerText = "> GENERATING CLIENT KEYS...";
                if (!this.clientKeyPair) this.clientKeyPair = window.sodium.crypto_kx_keypair();
                const connRes = new Uint8Array(36);
                connRes[0] = 0x04;
                connRes[1] = version;
                connRes[2] = 0x02;
                connRes[3] = 0x00;
                connRes.set(this.clientKeyPair.publicKey, 4);
                window.appLogger.log('INFO', 'TO ROBOT', `Sending client public key: ${this.bufToHex(connRes)}`);
                await this.sendFramedPayload(this.writeChar, connRes);
                return;
            }
            if (cladTag === 0x03 && cladData.length >= 48) {
                this.toRobotNonce = cladData.slice(0, 24);
                this.toDeviceNonce = cladData.slice(24, 48);
                window.appLogger.log('INFO', 'LOCAL', `Nonces established. toRobot: ${this.bufToHex(this.toRobotNonce)}, toDevice: ${this.bufToHex(this.toDeviceNonce)}`);
                if (statusText) statusText.innerText = "> SUCCESS! CHECK VECTOR SCREEN FOR PIN.";
                const pinSection = document.getElementById('pin-entry-section');
                if (pinSection) pinSection.style.display = 'block';
                return;
            }
            if (cladTag === 0x15) {
                window.appLogger.log('WARN', 'FROM ROBOT', 'Pairing cancelled by robot.');
                return;
            }
            if (cladTag === 0x10) {
                window.appLogger.log('WARN', 'FROM ROBOT', `Aborted message received: ${this.bufToHex(cladData)}`);
                return;
            }
            if (cladTag > 0x04 && cladTag !== 0x10 && cladTag !== 0x15) {
                window.appLogger.log('INFO', 'FROM ROBOT', `Secure pairing confirmed via Tag 0x${cladTag.toString(16)}`);
                if (statusText) statusText.innerText = "> SECURE PAIRING COMPLETE!";
            }
        }
    }

    async submitPin() {
        const rawPin = document.getElementById('vector-pin-input').value;
        const cleanPin = rawPin.replace(/\D/g, '');
        const statusText = document.getElementById('vector-setup-status');
        if (cleanPin.length !== 6) {
            window.appLogger.log('WARN', 'LOCAL', `Invalid PIN format: ${cleanPin.length} digits`);
            if (statusText) statusText.innerText = "> ERR: PIN MUST BE 6 DIGITS";
            return;
        }
        window.appLogger.log('INFO', 'LOCAL', `PIN ${cleanPin} submitted. Requesting hashed keys from backend.`);
        if (statusText) statusText.innerText = "> ESTABLISHING SECURE CHANNEL...";
        document.getElementById('pin-entry-section').style.display = 'none';
        try {
            await window.sodium.ready;
            const sodium = window.sodium;
            const sessionKeys = sodium.crypto_kx_client_session_keys(
                this.clientKeyPair.publicKey,
                this.clientKeyPair.privateKey,
                this.robotPublicKey
            );

            const hashPayload = {
                pin: cleanPin,
                sharedRx: sodium.to_hex(sessionKeys.sharedRx),
                sharedTx: sodium.to_hex(sessionKeys.sharedTx)
            };
            
            window.appLogger.log('INFO', 'LOCAL', `Sending Hash Request. Payload: ${JSON.stringify(hashPayload)}`);

            const response = await fetch('/api/vector/ble/hash_pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(hashPayload)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                window.appLogger.log('ERROR', 'LOCAL', `API failure. Status: ${response.status} ${response.statusText}. Response: ${errorBody}`);
                throw new Error(`Server cryptography error: ${response.status} ${response.statusText}`);
            }

            const hashData = await response.json();
            this.rxKey = sodium.from_hex(hashData.rx_key);
            this.txKey = sodium.from_hex(hashData.tx_key);
            
            window.appLogger.log('INFO', 'LOCAL', `Hashed session keys received. RX: ${this.bufToHex(this.rxKey)}, TX: ${this.bufToHex(this.txKey)}`);
            if (!this.nonceAckSent) {
                const ackData = new Uint8Array([0x04, 0x05, 0x12, 0x03]);
                window.appLogger.log('INFO', 'TO ROBOT', `Sending RtsAck for Nonces: ${this.bufToHex(ackData)}`);
                await this.sendFramedPayload(this.writeChar, ackData);
                this.nonceAckSent = true;
                this.isSecureChannel = true;
                if (statusText) statusText.innerText = "> KEYS DERIVED. AWAITING ENCRYPTED CHALLENGE...";
            } else if (this.pendingChallenge) {
                window.appLogger.log('INFO', 'LOCAL', 'Retrying challenge decryption with hashed session keys.');
                const payloadCopy = new Uint8Array(this.pendingChallenge);
                this.pendingChallenge = null;
                await this.processSecurePayload(payloadCopy);
            }
        } catch (error) {
            window.appLogger.log('ERROR', 'LOCAL', `Server crypto failure: ${error.message}`);
            if (statusText) statusText.innerText = "> ERR: CRYPTO ENGINE FAILED";
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
            window.appLogger.log('INFO', 'LOCAL', `Multipart START detected. Encrypted: ${isEncryptedHeader}`);
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
            window.appLogger.log('INFO', 'LOCAL', 'Multipart END detected. Processing reassembled buffer.');
            await this.processPayload(this.multipartBuffer, this.isReceivingEncrypted);
            this.multipartBuffer = new Uint8Array(0);
        }
    }

    async startPairing() {
        const statusText = document.getElementById('vector-setup-status');
        this.rxBuffer = new Uint8Array(0);
        this.multipartBuffer = new Uint8Array(0);
        this.isReceivingEncrypted = false;
        this.isSecureChannel = false;
        this.nonceAckSent = false;
        this.pendingChallenge = null;
        this.clientKeyPair = null;
        this.robotPublicKey = null;
        try {
            if (!window.sodium) throw new Error("Libsodium-wrappers cryptography library not loaded.");
            await window.sodium.ready;
            window.appLogger.log('INFO', 'LOCAL', 'Scanning for Bluetooth devices...');
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