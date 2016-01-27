import * as http from 'http'
import * as https from 'https'
import config from '../config'

const _http = config.db.protocol === 'https' ? https : http
let _etag = ''

interface PageConfig { // read from db that created from SPA
  _id: string
  name: string // name of dir
  domain: string[]
  fallback: string
  enabled: boolean
  local: boolean // allow for local domain; ex. https://neppage.com/mypage
  ssl: {
    cert: string // base64
    key: string // base64
    ca: string // base64, bundle
    force: boolean
    enabled: boolean
  }
}

class PageConfig {
  constructor (obj: PageConfig) {
    this._id = obj._id || ''
    this.name = obj.name || ''
    this.domain = obj.domain || []
    this.fallback = obj.fallback || ''
    this.enabled = obj.enabled || false
    this.local = obj.local || false
    let ssl = !!obj.ssl
    this.ssl = {
      cert: ssl && obj.ssl.cert || '',
      key: ssl && obj.ssl.key || '',
      ca: ssl && obj.ssl.ca || '',
      force: ssl && obj.ssl.force || false,
      enabled: ssl && obj.ssl.enabled || false
    }
  }

  get valid (): boolean {
    return this._id && this.name && this.enabled
  }

  static load (cb: (err, result) => void): void {
    let opt: http.RequestOptions = {
      host: config.db.host,
      port: config.db.port,
      path: '/' + config.db.ns,
      method: 'POST',
      headers: {
        'Content-Type': 'application/nepq',
        'Authorization': 'Bearer ' + config.db.token,
        'If-None-Match': _etag
      }
    }
    let req = _http.request(opt, res => {
      let data = []
      res
        .on('data', d => {
          data.push(d)
        })
        .on('end', () => {
          if (res.statusCode !== 200) return cb(null, null)
          try {
            let result = (<PageConfig[]> JSON.parse(Buffer.concat(data).toString('utf8')))
              .map(x => new PageConfig(x))
              .filter(x => x.valid)
            _etag = res.headers.etag
            cb(null, result)
          } catch (e) {
            cb(e, null)
          }
        })
    })
    req.on('error', e => cb(e, null))
    req.end('list configs')
  }
}

export default PageConfig
