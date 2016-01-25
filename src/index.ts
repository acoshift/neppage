import express = require('express');
import http = require('http');
import https = require('https');
import path = require('path');
import url = require('url');
import fs = require('fs');
import _ = require('lodash');
import appConfig = require('./config');

function decode (base64: string): string {
  return base64 ? new Buffer(base64, 'base64').toString() : null;
}

appConfig.db.token = decode(appConfig.db.token);
appConfig.route.token = decode(appConfig.route.token);

var dbHttp = appConfig.db.protocol === 'https' ? https : http;
var routeHttp = appConfig.route.protocol === 'https' ? https : http;

interface PageConfig { // read from db that created from SPA
  _id: string;
  name: string; // name of dir
  domain: string[];
  fallback: string;
  enabled: boolean;
  local: boolean; // allow for local domain; ex. https://neppage.com/mypage
  ssl: {
    cert: string; // base64
    key: string; // base64
    ca: string; // base64, bundle
    force: boolean;
    enabled: boolean;
  }
}

interface RouteConfig { // write to neproute db
  _id?: string;
  priority: number;
  domain: string[];
  host: string; // this server / localhost
  port: number; // appConfig.port
  prefix: string; // PageConfig.name
  enabled: boolean;
  ssl: { // copy from PageConfig.ssl
    cert: string;
    key: string;
    ca: string;
    force: boolean;
  },
  pageId: string; // PageConfig._id
  updated?: boolean;
}

var app = express();
app.disable('x-powered-by');

var configs: PageConfig[] = [];
var etag = '';
var routeEtag = '';

function load(c: PageConfig): PageConfig {
  if (!c._id || !c.name || !c.enabled) return null;
  if (!c.domain) c.domain = [];
  if (!c.fallback) c.fallback = '';
  if (!c.ssl) c.ssl = {
    cert: '',
    key: '',
    ca: '',
    force: false,
    enabled: false
  };
  return c;
}

function reloadPageConfig(): void {
  let opt: http.RequestOptions = {
    host: appConfig.db.host,
    port: appConfig.db.port,
    path: '/' + appConfig.db.ns,
    method: 'POST',
    headers: {
      'Content-Type': 'application/nepq',
      'Authorization': 'Bearer ' + appConfig.db.token,
      'If-None-Match': etag
    }
  };
  let req = dbHttp.request(opt, res => {
    let data = [];
    res.on('data', d => {
      data.push(d);
    }).on('end', () => {
      if (res.statusCode !== 200) return;
      try {
        let cfs: PageConfig[] = JSON.parse(Buffer.concat(data).toString('utf8'));
        let nconfig: PageConfig[] = [];
        cfs.forEach(x => {
          let c = load(x);
          if (c) nconfig.push(c);
        });
        configs = nconfig;
        etag = res.headers['etag'];
      } catch(e) {}
      writeRouteConfig();
    });
  });
  req.on('error', () => {});
  req.write('list configs');
  req.end();
}

setInterval(reloadPageConfig, appConfig.interval);
reloadPageConfig();

function writeRouteConfig(): void {
  let pageConfig = configs;
  let opt: http.RequestOptions = {
    host: appConfig.route.host,
    port: appConfig.route.port,
    path: '/' + appConfig.route.ns,
    method: 'POST',
    headers: {
      'Content-Type': 'application/nepq',
      'Authorization': 'Bearer ' + appConfig.route.token,
      'If-None-Match': routeEtag
    }
  };
  let req = routeHttp.request(opt, res => {
    let data = [];
    res.on('data', d => {
      data.push(d);
    }).on('end', () => {
      if (res.statusCode !== 200) return;
      try {
        let nconfig: RouteConfig[] = JSON.parse(Buffer.concat(data).toString('utf8'));
        routeEtag = res.headers['etag'];

        // deep check and update
        _.forEach(pageConfig, x => {
          if (_.isEmpty(x.domain)) return;
          let routeConfig = _.find(nconfig, y => y.pageId === x._id);
          let id;
          if (routeConfig) {
            routeConfig.updated = true;
            id = routeConfig._id;
            // check diff
            let eq = (() => {
              return routeConfig.priority === appConfig.route.config.priority &&
                     _.isEqual(routeConfig.domain, x.domain) &&
                     routeConfig.host === appConfig.route.config.host &&
                     routeConfig.port === appConfig.route.config.port &&
                     routeConfig.prefix === '/' + x.name &&
                     routeConfig.enabled === x.ssl.enabled &&
                     _.isEqual(routeConfig.ssl, { cert: x.ssl.cert, key: x.ssl.key, ca: x.ssl.ca,
                                                  force: x.ssl.force }) &&
                     routeConfig.pageId === x._id
            })();
            if (eq) return;
          }
          let doc = {
            priority: appConfig.route.config.priority,
            domain: x.domain,
            host: appConfig.route.config.host,
            port: appConfig.route.config.port,
            prefix: '/' + x.name,
            enabled: x.ssl.enabled,
            ssl: {
              cert: x.ssl.cert,
              key: x.ssl.key,
              ca: x.ssl.ca,
              force: x.ssl.force
            },
            pageId: x._id
          };
          let opt: http.RequestOptions = {
            host: appConfig.route.host,
            port: appConfig.route.port,
            path: '/' + appConfig.route.ns,
            method: 'POST',
            headers: {
              'Content-Type': 'application/nepq',
              'Authorization': 'Bearer ' + appConfig.route.token
            }
          };
          let req = routeHttp.request(opt, res => {});
          req.on('error', () => {});
          if (id) {
            req.write(`update configs("${id}",${JSON.stringify(doc)}){}`);
          } else {
            req.write(`create configs(${JSON.stringify(doc)}){}`);
          }
          req.end();
        });

        // delete not exists config
        let deleteIds = _(nconfig).filter(x => !x.updated).map(x => x._id);
        let opt: http.RequestOptions = {
          host: appConfig.route.host,
          port: appConfig.route.port,
          path: '/' + appConfig.route.ns,
          method: 'POST',
          headers: {
            'Content-Type': 'application/nepq',
            'Authorization': 'Bearer ' + appConfig.route.token
          }
        };
        let req = routeHttp.request(opt, res => {});
        req.on('error', () => {});
        req.write(`delete configs(${JSON.stringify(deleteIds)}){}`);
        req.end();
      } catch(e) {}
    });
  });
  req.on('error', () => {});
  req.write('list configs');
  req.end();
}

app.use((req, res, next) => {
  // find PageConfig from request
  let u = url.parse(req.url);
  let q = u.pathname.split('/');
  q.shift();
  let [ name ] = q;

  let c = _.find(configs, x => x.name === name);
  if (!c) {
    // no config => local
    req.url = `/local${req.url}`;
    return next();
  }

  // Is not allow local and from local, reject 404
  let local = _.some(appConfig.hostname, x => x === req.hostname);
  if (!c.local && local) return res.sendStatus(404);

  // check fallback and file exists
  if (c.fallback && !fs.existsSync(path.join(__dirname, appConfig.pagesDir, u.pathname))) {
    req.url = `/${name}/${c.fallback}`;
  }

  next();
});

app.use(express.static(path.join(__dirname, appConfig.pagesDir)));

app.use((req, res) => { res.sendStatus(404); });

app.listen(appConfig.port);
