"use strict";
/* jshint esversion: 6, asi: true, node: true */
// app.js

var path = require("path");
var fs = require("fs");
var nodeRoot = path.dirname(require.main.filename);
var configPath = path.join(nodeRoot, "config.json");
var publicPath = path.join(nodeRoot, "client", "public");
console.log("WebSSH2 service reading config from: " + configPath);
var express = require("express");
var logger = require("morgan");

// sane defaults if config.json or parts are missing
let config = {
  listen: {
    ip: "0.0.0.0",
    port: 2222,
  },
  user: {
    name: null,
    password: null,
    privatekey: null,
  },
  ssh: {
    host: null,
    port: 22,
    term: "xterm-color",
    readyTimeout: 20000,
    keepaliveInterval: 120000,
    keepaliveCountMax: 10,
    allowedSubnets: [],
  },
  terminal: {
    cursorBlink: true,
    scrollback: 10000,
    tabStopWidth: 8,
    bellStyle: "sound",
  },
  header: {
    text: null,
    background: "green",
  },
  session: {
    name: "WebSSH2",
    secret: "mysecret",
  },
  options: {
    challengeButton: true,
    allowreauth: true,
  },
  algorithms: {
    kex: [
      "ecdh-sha2-nistp256",
      "ecdh-sha2-nistp384",
      "ecdh-sha2-nistp521",
      "diffie-hellman-group-exchange-sha256",
      "diffie-hellman-group14-sha1",
    ],
    cipher: [
      "aes128-ctr",
      "aes192-ctr",
      "aes256-ctr",
      "aes128-gcm",
      "aes128-gcm@openssh.com",
      "aes256-gcm",
      "aes256-gcm@openssh.com",
      "aes256-cbc",
    ],
    hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1"],
    compress: ["none", "zlib@openssh.com", "zlib"],
  },
  serverlog: {
    client: false,
    server: false,
  },
  accesslog: false,
  verify: false,
  safeShutdownDuration: 300,
};

// test if config.json exists, if not provide error message but try to run
// anyway
try {
  if (fs.existsSync(configPath)) {
    console.log("ephemeral_auth service reading config from: " + configPath);
    config = require("read-config-ng")(configPath);
  } else {
    console.error(
      "\n\nERROR: Missing config.json for webssh. Current config: " +
        JSON.stringify(config)
    );
    console.error("\n  See config.json.sample for details\n\n");
  }
} catch (err) {
  console.error(
    "\n\nERROR: Missing config.json for webssh. Current config: " +
      JSON.stringify(config)
  );
  console.error("\n  See config.json.sample for details\n\n");
  console.error("ERROR:\n\n  " + err);
}

var session = require("express-session")({
  secret: config.session.secret,
  name: config.session.name,
  resave: true,
  saveUninitialized: false,
  unset: "destroy",
});
var app = express();
var server = require("https").createServer(
  {
    key: fs.readFileSync(
      "./server/tls/privkey.pem"
    ),
    cert: fs.readFileSync(
      "./server/tls/fullchain.pem"
    ),
  },
  app
);
var myutil = require("./util");
myutil.setDefaultCredentials(
  config.user.name,
  config.user.password,
  config.user.privatekey
);
var validator = require("validator");
var io = require("socket.io")(server, {
  serveClient: false,
  path: "/ssh/socket.io",
});
var socket = require("./socket");
var expressOptions = require("./expressOptions");
var favicon = require("serve-favicon");

var redirApp = express();
var httpServer = require("http").createServer(redirApp);

redirApp.get("/*", (req, res) => {
  res.redirect(301, "https://shell.sillyctf.com/");
});

httpServer.listen(8080, () => {
  console.log("HTTP redirect server running on port 8080");
});

// express
app.use(safeShutdownGuard);
app.use(session);
app.use(myutil.basicAuth);
if (config.accesslog) app.use(logger("common"));
app.disable("x-powered-by");

// static files
app.use("/ssh", express.static(publicPath, expressOptions));

app.get("/", (req, res) => {
  res.set({
    "Strict-Transport-Security": "max-age=31536000",
  });
  res.redirect(302, "/ssh");
});

// favicon from root if being pre-fetched by browser to prevent a 404
app.use(favicon(path.join(publicPath, "favicon.ico")));

app.get("/ssh/reauth", function (req, res, next) {
  var r = req.headers.referer || "/";
  res
    .status(401)
    .send(
      '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=' +
        r +
        '"></head><body bgcolor="#000"></body></html>'
    );
});

// eslint-disable-next-line complexity
app.get("/ssh", function (req, res, next) {
  res.sendFile(path.join(path.join(publicPath, "client.htm")));
  // capture, assign, and validated variables
  req.session.ssh = {
    host: config.ssh.host,
    port: config.ssh.port,
    localAddress: config.ssh.localAddress,
    localPort: config.ssh.localPort,
    header: {
      name: config.header.text,
      background: config.header.background,
    },
    algorithms: config.algorithms,
    keepaliveInterval: config.ssh.keepaliveInterval,
    keepaliveCountMax: config.ssh.keepaliveCountMax,
    allowedSubnets: config.ssh.allowedSubnets,
    term: config.ssh.term,
    terminal: {
      cursorBlink: config.terminal.cursorBlink,
      scrollback: config.terminal.scrollback,
      tabStopWidth: config.terminal.tabStopWidth,
      bellStyle: config.terminal.bellStyle,
    },
    allowreplay: config.options.challengeButton,
    allowreauth: config.options.allowreauth || false,
    mrhsession: "none",
    serverlog: {
      client: config.serverlog.client || false,
      server: config.serverlog.server || false,
    },
    readyTimeout: config.ssh.readyTimeout,
  };
});

// express error handling
app.use(function (req, res, next) {
  res.status(404).send("Sorry can't find that!");
});

app.use(function (err, req, res, next) {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// socket.io
// expose express session with socket.request.session
io.use(function (socket, next) {
  socket.request.res
    ? session(socket.request, socket.request.res, next)
    : next(next);
});

// bring up socket
io.on("connection", socket);

// safe shutdown
var shutdownMode = false;
var shutdownInterval = 0;
var connectionCount = 0;

function safeShutdownGuard(req, res, next) {
  if (shutdownMode)
    res.status(503).end("Service unavailable: Server shutting down");
  else return next();
}

io.on("connection", function (socket) {
  connectionCount++;

  socket.on("disconnect", function () {
    if (--connectionCount <= 0 && shutdownMode) {
      stop("All clients disconnected");
    }
  });
});

const signals = ["SIGTERM", "SIGINT"];
signals.forEach((signal) =>
  process.on(signal, function () {
    if (shutdownMode) stop("Safe shutdown aborted, force quitting");
    else if (connectionCount > 0) {
      var remainingSeconds = config.safeShutdownDuration;
      shutdownMode = true;

      var message =
        connectionCount === 1
          ? " client is still connected"
          : " clients are still connected";
      console.error(connectionCount + message);
      console.error("Starting a " + remainingSeconds + " seconds countdown");
      console.error("Press Ctrl+C again to force quit");

      shutdownInterval = setInterval(function () {
        if (remainingSeconds-- <= 0) {
          stop("Countdown is over");
        } else {
          io.sockets.emit("shutdownCountdownUpdate", remainingSeconds);
        }
      }, 1000);
    } else stop();
  })
);

// clean stop
function stop(reason) {
  shutdownMode = false;
  if (reason) console.log("Stopping: " + reason);
  if (shutdownInterval) clearInterval(shutdownInterval);
  io.close();
  server.close();
}

module.exports = { server: server, config: config };
