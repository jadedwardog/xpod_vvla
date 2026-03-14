class AppLogger {
    constructor() {
        this.feedElement = null;
    }

    setFeedElement(element) {
        this.feedElement = element;
        
        if (this.feedElement) {
            this.feedElement.style.backgroundColor = 'rgba(0, 10, 0, 0.8)';
            this.feedElement.style.border = '1px solid #00ff00';
            this.feedElement.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.1), inset 0 0 10px rgba(0, 255, 0, 0.05)';
            this.feedElement.style.padding = '15px';
            this.feedElement.style.color = '#00ff00';
            this.feedElement.style.fontFamily = '"Share Tech Mono", monospace';
            this.feedElement.style.clipPath = 'polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)';
        }
    }

    async log(level, eventCode, message, data = null) {
        if (!this.feedElement) return;

        const entry = document.createElement('div');
        entry.style.marginBottom = '6px';
        entry.style.paddingBottom = '6px';
        entry.style.borderBottom = '1px solid rgba(0, 255, 0, 0.15)';
        
        this.feedElement.prepend(entry);

        const timestamp = new Date().toISOString();
        const timeStr = timestamp.split('T')[1].replace('Z', '');
        
        let hexData = undefined;
        let additionalData = undefined;

        if (data instanceof Uint8Array) {
            hexData = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
        } else if (data) {
            additionalData = data;
        }

        const quotePromise = window.quoteManager 
            ? window.quoteManager.getRandomQuote(eventCode) 
            : Promise.resolve("System message.");

        quotePromise.then(quote => {
            const pre = document.createElement('pre');
            pre.style.margin = '0';
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordBreak = 'break-all';
            pre.style.fontSize = '0.85rem';
            pre.style.lineHeight = '1.4';
            
            if (level === 'ERROR' || level === 'CRITICAL') {
                pre.style.color = '#ff003c';
                pre.style.textShadow = '0 0 8px rgba(255, 0, 60, 0.6)';
            } else if (level === 'WARN') {
                pre.style.color = '#ffb700';
                pre.style.textShadow = '0 0 8px rgba(255, 183, 0, 0.6)';
            } else {
                pre.style.color = '#00ff00';
                pre.style.textShadow = '0 0 8px rgba(0, 255, 0, 0.6)';
            }

            let terminalOutput = `[${timeStr}] [${level}] ${message}\n> ${quote}`;
            if (hexData) terminalOutput += `\n[HEX]: ${hexData}`;
            if (additionalData) terminalOutput += `\n[DATA]: ${JSON.stringify(additionalData)}`;

            pre.innerText = terminalOutput;
            entry.appendChild(pre);
        }).catch(err => {
            console.error("Failed to retrieve quote for log entry", err);
        });
    }
}

window.appLogger = new AppLogger();

document.addEventListener("DOMContentLoaded", () => {
    const navItems = document.querySelectorAll('.nav-item');
    const setupContainer = document.getElementById('dynamic-setup-container');
    const eyesDisplay = document.getElementById('eyes-display');
    const bottomTitle = document.querySelector('.bottom-status .title');
    let currentActiveModule = null;

    const renderPanel = async (targetId) => {
        if (currentActiveModule && typeof currentActiveModule.shutdown === 'function') {
            currentActiveModule.shutdown();
        }
        currentActiveModule = null;

        setupContainer.style.display = 'block';
        setupContainer.innerHTML = '';
        eyesDisplay.style.opacity = '0.1';

        if (targetId === 'server-settings') {
            bottomTitle.innerText = 'SERVER SETTINGS';
            setupContainer.innerHTML = `
                <h2 style="margin-top:0; border-bottom:1px solid rgba(0,255,0,0.3); padding-bottom:10px;">SERVER STATUS</h2>
                <p>STATUS: <span style="color:#00ff00; text-shadow:0 0 10px #00ff00;">ONLINE</span></p>
                <p>PORT: 30301</p>
                <p>UPTIME: <span id="uptime-counter">00:00:00</span></p>
                <div style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="neon-btn" onclick="document.getElementById('dynamic-setup-container').style.display='none'; document.getElementById('eyes-display').style.opacity='1'; document.querySelector('.bottom-status .title').innerText='DASHBOARD';">CLOSE MENU</button>
                    <button id="shutdown-server-btn" class="neon-btn" style="border-color: #ff003c; color: #ff003c;">SHUTDOWN CORE SERVER</button>
                </div>
            `;

            document.getElementById('shutdown-server-btn').addEventListener('click', async () => {
                const confirmed = confirm("WARNING: Are you sure you want to terminate the xpod core server? This will drop all AI cognition state and kill all sidecar processes.");
                if (confirmed) {
                    try {
                        window.appLogger.log('CRITICAL', 'SYSTEM', 'User triggered remote server shutdown sequence. Halting sidecars...');
                        if (currentActiveModule && typeof currentActiveModule.shutdown === 'function') {
                            currentActiveModule.shutdown();
                        }
                        window.appLogger.log('CRITICAL', 'SYSTEM', 'Transmitting SIGKILL to core server...');
                        await fetch('/api/core/shutdown', { method: 'POST' });
                        document.body.innerHTML = '<div style="display:flex; height:100vh; width:100vw; justify-content:center; align-items:center; background:#000; color:#ff003c; font-family:monospace; font-size:2rem; text-shadow:0 0 10px #ff003c;">[ CORE SERVER & SIDECARS OFFLINE ]</div>';
                    } catch (e) {
                        window.appLogger.log('ERROR', 'SYSTEM', `Shutdown payload failed: ${e.message}`);
                    }
                }
            });
        } 
        else if (targetId === 'bot-settings') {
            bottomTitle.innerText = 'ACTIVE DEVICES';
            setupContainer.innerHTML = `
                <h2 style="margin-top:0; border-bottom:1px solid rgba(0,255,0,0.3); padding-bottom:10px;">CONNECTED BOTS</h2>
                <ul style="list-style-type: square; padding-left: 20px; color: rgba(0,255,0,0.7);">
                    <li>No active telemetry streams.</li>
                </ul>
                <button class="neon-btn" style="margin-top: 20px;" onclick="document.getElementById('dynamic-setup-container').style.display='none'; document.getElementById('eyes-display').style.opacity='1'; document.querySelector('.bottom-status .title').innerText='DASHBOARD';">CLOSE MENU</button>
            `;
        }
        else if (targetId === 'bot-setup') {
            bottomTitle.innerText = 'PROVISIONING';
            setupContainer.innerHTML = `
                <h2 style="margin-top:0; border-bottom:1px solid rgba(0,255,0,0.3); padding-bottom:10px;">ADD DEVICE</h2>
                <p style="font-size: 0.9rem; color: rgba(0,255,0,0.7);">Select hardware platform sequence.</p>
                <select id="platform-selector">
                    <option value="vector">Anki Vector (v1.0)</option>
                </select>
                <button class="neon-btn" id="init-platform-btn">INITIATE HANDSHAKE</button>
            `;

            document.getElementById('init-platform-btn').addEventListener('click', async () => {
                const platform = document.getElementById('platform-selector').value;
                if (platform === 'vector' && window.VectorSetup) {
                    const vectorSetup = new window.VectorSetup();
                    currentActiveModule = vectorSetup;
                    await vectorSetup.renderUI(setupContainer);
                } else {
                    setupContainer.innerHTML = `<p style="color:#ff003c;">ERR: Module missing or platform unsupported.</p>`;
                }
            });
        }
        else if (targetId === 'virtual-sidecar') {
            bottomTitle.innerText = 'VIRTUAL SIDECAR';
            if (window.VirtualSidecar) {
                const virtualSidecar = new window.VirtualSidecar();
                currentActiveModule = virtualSidecar;
                await virtualSidecar.renderUI(setupContainer);
            } else {
                setupContainer.innerHTML = `
                    <h2 style="margin-top:0; border-bottom:1px solid rgba(0,255,0,0.3); padding-bottom:10px;">VIRTUAL SIDECAR</h2>
                    <p style="color:#ff003c;">ERR: VirtualSidecar script failed to load. Check console.</p>
                `;
            }
        }
        else if (targetId === 'logs') {
            bottomTitle.innerText = 'SYSTEM LOG';
            setupContainer.innerHTML = `
                <h2 style="margin-top:0; border-bottom:1px solid rgba(0,255,0,0.3); padding-bottom:10px;">TERMINAL OUTPUT</h2>
                <div id="global-log-container" style="height: 300px; overflow-y: auto;"></div>
                <button class="neon-btn" style="margin-top: 20px;" onclick="document.getElementById('dynamic-setup-container').style.display='none'; document.getElementById('eyes-display').style.opacity='1'; document.querySelector('.bottom-status .title').innerText='DASHBOARD';">CLOSE MENU</button>
            `;
            window.appLogger.setFeedElement(document.getElementById('global-log-container'));
            window.appLogger.log('INFO', 'system', 'Log viewer initialized.');
        }
        else {
            bottomTitle.innerText = targetId.toUpperCase().replace('-', ' ');
            setupContainer.innerHTML = `
                <h2 style="margin-top:0; border-bottom:1px solid rgba(0,255,0,0.3); padding-bottom:10px;">${targetId.toUpperCase()}</h2>
                <p style="color: #ffb700; text-shadow: 0 0 8px rgba(255,183,0,0.6);">[WARN] Module not yet implemented in v0.0.1-a.</p>
                <button class="neon-btn" style="margin-top: 20px;" onclick="document.getElementById('dynamic-setup-container').style.display='none'; document.getElementById('eyes-display').style.opacity='1'; document.querySelector('.bottom-status .title').innerText='DASHBOARD';">CLOSE MENU</button>
            `;
        }
    };

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = e.target.getAttribute('data-target');
            renderPanel(target);
        });
    });
});