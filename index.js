const {
  default: makeWASocket,
  MessageType,
  MessageOptions,
  Mimetype,
  DisconnectReason,
  BufferJSON,
  AnyMessageContent,
  delay,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  MessageRetryMap,
  useMultiFileAuthState,
  msgRetryCounterMap,
} = require("@whiskeysockets/baileys");

const log = (pino = require("pino"));
const { session } = { session: "session_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require("path");
const fs = require("fs");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();
const TOKEN = 'abc123..';

// Habilitar la carga de archivos
app.use(
  fileUpload({
    createParentPath: true,
  })
);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8080;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/scan", (req, res) => {
  res.sendFile("./client/index.html", {
    root: __dirname,
  });
});

app.get("/", (req, res) => {
  res.send("server working");
});

let sock;
let qrDinamic;
let soket;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("session_auth_info");

  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: log({ level: "silent" }),
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    qrDinamic = qr;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect.error).output.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(
          `Bad Session File, Please Delete ${session} and Scan Again`
        );
        sock.logout();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Conexión cerrada, reconectando....");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Conexión perdida del servidor, reconectando...");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log(
          "Conexión reemplazada, otra nueva sesión abierta, cierre la sesión actual primero"
        );
        sock.logout();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(
          `Dispositivo cerrado, elimínelo ${session} y escanear de nuevo.`
        );
        sock.logout();
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Se requiere reinicio, reiniciando...");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Se agotó el tiempo de conexión, conectando...");
        connectToWhatsApp();
      } else {
        sock.end(
          `Motivo de desconexión desconocido: ${reason}|${lastDisconnect.error}`
        );
      }
    } else if (connection === "open") {
      console.log("conexión abierta");
      return;
    }
  });

  //==============================================================================

 //Tabla simulada con las palabras clave y sus respuestas
  const respuestasTabla = [
    { keyword: "pam", respuesta: "Pum" },
    { keyword: "cual eres", respuesta: "Soy Orlo, un bot de whatsapp creado para ayudar a mi amo." },
    { keyword: "a", respuesta: "e" },
  ];

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type === "notify") {
        if (!messages[0]?.key.fromMe) {
          const captureMessage = messages[0]?.message?.conversation;
          const numberWa = messages[0]?.key?.remoteJid;
  
          // Normalizamos el mensaje capturado (pasamos a minúsculas para comparación)
          const compareMessage = captureMessage.toLowerCase();
          console.log("--> Nro de Origen: " + numberWa);
  
          // Buscar en la tabla si el mensaje contiene alguna palabra clave
          const respuestaEncontrada = respuestasTabla.find((item) =>
            compareMessage.includes(item.keyword)
          );
  
          // Si se encontró una palabra clave, enviar la respuesta correspondiente
          if (respuestaEncontrada) {
            await sock.sendMessage(
              numberWa,
              {
                text: respuestaEncontrada.respuesta,
              },
              {
                quoted: messages[0],
              }
            );
          }
        }
      }
    } catch (error) {
      console.log("error ", error);
    }
  });

  //==============================================================================

  sock.ev.on("creds.update", saveCreds);
}

const isConnected = () => {
  return sock?.user ? true : false;
};

//==============================================================================

app.post("/send-message", async (req, res) => {
  
  // Verificar el token en los encabezados
  const token = req.headers['authorization'];

  console.log("--> var: " + TOKEN);
  console.log("--> input: " + token);

  if (!token || token !== `Bearer ${TOKEN}`) {
    return res.status(401).json({
      status: false,
      response: "No autorizado",
    });
  }
  
  const tempMessage = req.body.message;
  const number = req.body.number;
  const imageUrl = req.body.imageUrl; // Nuevo parámetro para la URL de la imagen

  let numberWA;
  try {
    if (!number) {
      return res.status(500).json({
        status: false,
        response: "El número no existe",
      });
    }

    // Formateo del número para mensajes individuales o grupos
    if (number.toString().length < 15) {
      numberWA = number + "@s.whatsapp.net"; // Mensajes individuales
    } else {
      numberWA = number + "@g.us"; // Mensajes a grupos
    }

    if (isConnected()) {
      console.log("--> Conectado");

      // Función para enviar mensaje de texto o imagen
      const sendMessage = async (jid) => {
        try {
          if (imageUrl) {
            // Si se proporciona una URL de imagen, envía la imagen
            const result = await sock.sendMessage(jid, {
              image: { url: imageUrl },
              caption: tempMessage || "", // Texto opcional como pie de foto
            });
            return res.status(200).json({
              status: true,
              response: result,
            });
          } else {
            // Si no se proporciona imagen, envía un mensaje de texto
            const result = await sock.sendMessage(jid, {
              text: tempMessage,
            });
            return res.status(200).json({
              status: true,
              response: result,
            });
          }
        } catch (err) {
          return res.status(500).json({
            status: false,
            response: err,
          });
        }
      };

      // Enviar a grupo o usuario individual
      if (numberWA.endsWith("@g.us")) {
        // Enviar directamente al grupo
        await sendMessage(numberWA);
      } else {
        // Verificar si el número está registrado en WhatsApp antes de enviar el mensaje
        const exist = await sock.onWhatsApp(numberWA);
        if (exist?.jid || (exist && exist[0]?.jid)) {
          await sendMessage(exist.jid || exist[0].jid);
        } else {
          return res.status(500).json({
            status: false,
            response: "El número no está registrado en WhatsApp",
          });
        }
      }
    } else {
      return res.status(500).json({
        status: false,
        response: "Aún no estás conectado",
      });
    }
  } catch (err) {
    return res.status(500).send(err);
  }
});

//==============================================================================

io.on("connection", async (socket) => {
  soket = socket;
  if (isConnected()) {
    updateQR("connected");
  } else if (qrDinamic) {
    updateQR("qr");
  }
});

const updateQR = (data) => {
  switch (data) {
    case "qr":
      qrcode.toDataURL(qrDinamic, (err, url) => {
        soket?.emit("qr", url);
        soket?.emit("log", "QR recibido , scan");
      });
      break;
    case "connected":
      soket?.emit("qrstatus", "./assets/check.svg");
      soket?.emit("log", " usaario conectado");
      const { id, name } = sock?.user;
      var userinfo = id + " " + name;
      soket?.emit("user", userinfo);

      break;
    case "loading":
      soket?.emit("qrstatus", "./assets/loader.gif");
      soket?.emit("log", "Cargando ....");

      break;
    default:
      break;
  }
};

connectToWhatsApp().catch((err) => console.log("unexpected error: " + err)); // catch any errors
server.listen(port, () => {
  console.log("Server Run Port : " + port);
});
