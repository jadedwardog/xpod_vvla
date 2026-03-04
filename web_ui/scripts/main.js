const VECTOR_WRITE_UUID = '7d2a4bda-d29b-4152-b725-2491478c5cd7';
const VECTOR_NOTIFY_UUID = '30619f2d-0f54-41bd-a65a-7588d8c85b45';

const rtsProto = `
syntax = "proto3";
package anki.vector.setup;
message RtsConnectionRequest { string pin = 1; }
message RtsWifiConnectRequest { string ssid_hex = 1; string password = 2; int32 auth_type = 3; int32 timeout = 4; }
message RtsStatusResponse { int32 wifi_state = 1; int32 access_point_type = 2; string ssid = 3; uint32 ip_v4 = 4; }
`;

document.addEventListener("DOMContentLoaded", async () => {
    const pairBtn = document.getElementById('ble-pair-btn');
    const statusText = document.getElementById('setup-status');
    const emailInput = document.getElementById('anki-email');
    const passwordInput = document.getElementById('anki-password');

    const root = protobuf.parse(rtsProto).root;
    const RtsConnectionRequest = root.lookupType("anki.vector.setup.RtsConnectionRequest");
    const RtsWifiConnectRequest = root.lookupType("anki.vector.setup.RtsWifiConnectRequest");
    const RtsStatusResponse = root.lookupType("anki.vector.setup.RtsStatusResponse");

    pairBtn.addEventListener('click', async () => {
        try {
            if (!emailInput.value || !passwordInput.value) {
                throw new Error("Please enter your Anki account details first.");
            }

            statusText.innerText = "Requesting Vector Bluetooth device...";
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Vector-' }],
                optionalServices: ['0000fee3-0000-1000-8000-00805f9b34fb']
            });

            statusText.innerText = "Connecting to GATT Server...";
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService('0000fee3-0000-1000-8000-00805f9b34fb');
            const writeChar = await service.getCharacteristic(VECTOR_WRITE_UUID);
            const notifyChar = await service.getCharacteristic(VECTOR_NOTIFY_UUID);

            await notifyChar.startNotifications();
            statusText.innerText = "Connected. Please check Vector's screen for a PIN.";

            const pin = prompt("Enter the 6-digit PIN from Vector's screen:");
            if (!pin) return;

            const pinMsg = RtsConnectionRequest.create({ pin });
            const pinBuffer = RtsConnectionRequest.encode(pinMsg).finish();
            const pinPayload = new Uint8Array([0x01, ...pinBuffer]);
            await writeChar.writeValueWithoutResponse(pinPayload);

            const ssid = prompt("Enter your Wi-Fi SSID (2.4GHz only):");
            const wifiPass = prompt("Enter your Wi-Fi Password:");
            
            const ssidHex = Array.from(new TextEncoder().encode(ssid))
                .map(b => b.toString(16).padStart(2, '0')).join('');

            const wifiMsg = RtsWifiConnectRequest.create({
                ssidHex: ssidHex,
                password: wifiPass,
                authType: 3,
                timeout: 20
            });
            const wifiBuffer = RtsWifiConnectRequest.encode(wifiMsg).finish();
            const wifiPayload = new Uint8Array([0x05, ...wifiBuffer]);
            await writeChar.writeValueWithoutResponse(wifiPayload);

            statusText.innerText = "Wi-Fi credentials sent. Waiting for IP address...";

            notifyChar.addEventListener('characteristicvaluechanged', async (event) => {
                const val = new Uint8Array(event.target.value.buffer);
                if (val[0] === 0x04 || val[0] === 0x06) {
                    const response = RtsStatusResponse.decode(val.slice(1));
                    if (response.ipV4 > 0) {
                        const ip = [
                            (response.ipV4 & 0xff),
                            (response.ipV4 >> 8 & 0xff),
                            (response.ipV4 >> 16 & 0xff),
                            (response.ipV4 >> 24 & 0xff)
                        ].join('.');

                        statusText.innerText = `IP Found: ${ip}. Sending to xpod server...`;
                        
                        await fetch('/api/provision', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                ip: ip,
                                email: emailInput.value,
                                password: passwordInput.value
                            })
                        });

                        statusText.innerText = "Setup complete! Check your terminal.";
                        device.gatt.disconnect();
                    }
                }
            });

        } catch (error) {
            console.error(error);
            statusText.innerText = `Error: ${error.message}`;
        }
    });
});