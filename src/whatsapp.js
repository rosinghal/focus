const fs = require('node:fs');

const RECONNECT_MS = 5000;

const silentLogger = {
  level: 'silent',
  child: () => silentLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const jidFor = (number) => `${number.replace(/\D/g, '')}@s.whatsapp.net`;

const hasSession = (authDir) => {
  try {
    return Boolean(JSON.parse(fs.readFileSync(`${authDir}/creds.json`, 'utf8')).me);
  } catch {
    return false;
  }
};

// FOCUS_WHATSAPP_DRY_RUN logs codes instead of sending them, for end-to-end tests without a linked phone.
const createDryRunClient = ({ onStatus }) => {
  const client = {
    status: 'linked',
    connect: () => onStatus('linked'),
    sendText: async (number, text) => console.log(`[whatsapp dry run] to ${number}: ${text}`),
    logout: async () => onStatus((client.status = 'unlinked')),
  };
  return client;
};

const createClient = ({ authDir, onStatus, onQr }) => {
  if (process.env.FOCUS_WHATSAPP_DRY_RUN) return createDryRunClient({ onStatus });

  let socket = null;
  let reconnectTimer = null;
  const client = { status: hasSession(authDir) ? 'connecting' : 'unlinked' };

  const setStatus = (status) => {
    client.status = status;
    onStatus(status);
  };

  const connect = async () => {
    clearTimeout(reconnectTimer);
    // Leftover keys from an abandoned QR scan would otherwise be reused.
    if (!hasSession(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
    const baileys = await import('baileys');
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    socket?.end(undefined);
    socket = baileys.makeWASocket({
      auth: state,
      logger: silentLogger,
      browser: baileys.Browsers.macOS('Focus'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
    });
    const current = socket;
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (current !== socket) return;
      if (qr) {
        setStatus('qr');
        onQr(qr);
      }
      if (connection === 'open') setStatus('linked');
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === baileys.DisconnectReason.loggedOut) {
          fs.rmSync(authDir, { recursive: true, force: true });
          socket = null;
          setStatus('unlinked');
          return;
        }
        setStatus(hasSession(authDir) ? 'connecting' : 'unlinked');
        if (hasSession(authDir) || code === baileys.DisconnectReason.restartRequired) {
          reconnectTimer = setTimeout(connect, code === baileys.DisconnectReason.restartRequired ? 0 : RECONNECT_MS);
        }
      }
    });
  };

  const sendText = async (number, text) => {
    if (client.status !== 'linked' || !socket) throw new Error('WhatsApp is not connected.');
    const jid = jidFor(number);
    const sent = await socket.sendMessage(jid, { text });
    // Hide the code from the linked phone so it can't be read there; the recipient still gets it.
    try {
      await socket.chatModify(
        { deleteForMe: { key: sent.key, timestamp: Number(sent.messageTimestamp), deleteMedia: false } },
        sent.key.remoteJid ?? jid,
      );
    } catch {}
  };

  const logout = async () => {
    clearTimeout(reconnectTimer);
    const current = socket;
    socket = null;
    try {
      await current?.logout();
    } catch {}
    current?.end(undefined);
    fs.rmSync(authDir, { recursive: true, force: true });
    setStatus('unlinked');
  };

  return Object.assign(client, { connect, sendText, logout });
};

module.exports = { hasSession, createClient };
