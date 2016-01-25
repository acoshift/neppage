import express = require('express');
import path = require('path');
import url = require('url');
import fs = require('fs');
import appConfig = require('./config');

function decode (base64: string): string {
  return base64 ? new Buffer(base64, 'base64').toString() : null;
}

appConfig.db.token = decode(appConfig.db.token);
appConfig.route.token = decode(appConfig.route.token);

interface PageConfig { // read from db that created from SPA
  _id: string;
  name: string;
  domain: string[];
  fallback: string;
  enabled: boolean;
  ssl: {
    cert: string; // base64
    key: string; // base64
    ca: string; // base64, bundle
    force: boolean;
  }
}

interface RouteConfig { // write to neproute db
  priority: number;
  domain: string[];
  host: string; // this server / localhost
  port: number; // appConfig.port
  prefix: string; // ''
  enabled: boolean;
  ssl: { // copy from PageConfig.ssl
    cert: string;
    key: string;
    ca: string;
    force: boolean;
  }
}

var app = express();
app.disable('x-powered-by');

var root = './pages';
var configs = [];

app.use((req, res, next) => {
  let u = url.parse(req.url);
  let q = u.pathname.split('/');
  q.shift();
  let [ name ] = q;

  let c = configs[name];

  if (!c || c.time + 300000 < Date.now()) {
    let p = path.join(root, name);
    if (!fs.existsSync(p) || !fs.existsSync(p + '/.config.json')) {
      configs[name] = { time: Date.now() };
      next();
      return;
    }
    configs[name] = {
      data: JSON.parse(fs.readFileSync(`${p}/.config.json`).toString()),
      time: Date.now()
    };
    c = configs[name];
  }

  if (!c.data) { next(); return; }

  if (!c.data.enabled) {
    res.sendStatus(404);
    return;
  }

  if (c.data.nopath && req.hostname === 'farkpage.com') {
    res.sendStatus(404);
    return;
  }

  if (!c.data.entry || c.data.entry === '') {
    next();
    return;
  }

  let p = path.join(root, u.pathname);
  if (!fs.existsSync(p)) {
    req.url = `/${name}/${c.data.entry}`;
  }

  next();
});

app.use(express.static(path.join(__dirname, appConfig.pagesDir)));

app.use((req, res) => {
  res.sendStatus(404);
});

app.listen(8000);
