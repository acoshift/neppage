import * as http from 'http'
import * as https from 'https'
import config from '../config'
import PageConfig from './page-config'
import * as _ from 'lodash'

const _config = config.route
const _http = _config.protocol === 'https' ? https : http
let _etag = ''

interface RouteConfig { // write to neproute db
  _id?: string
  priority: number
  domain: string[]
  host: string // this server / localhost
  port: number // appConfig.port
  prefix: string // => PageConfig.name
  enabled: boolean
  ssl: { // copy from PageConfig.ssl
    cert: string
    key: string
    ca: string
    force: boolean
  },
  pageId: string // => PageConfig._id
}

class RouteConfig {
  shouldDelete: boolean

  constructor (obj: RouteConfig | PageConfig, createFromPage: boolean = false) {
    this.shouldDelete = true
    if (createFromPage) {
      let _obj = <PageConfig> obj
      this._id = null
      this.priority = _config.config.priority
      this.domain = _obj.domain || []
      this.host = _config.config.host
      this.port = _config.config.port
      this.prefix = '/' + _obj.name
      this.enabled = _obj.ssl.enabled
      this.ssl = {
        cert: _obj.ssl.cert,
        key: _obj.ssl.key,
        ca: _obj.ssl.ca,
        force: _obj.ssl.force
      }
      this.pageId = _obj._id
    } else {
      let _obj = <RouteConfig> obj
      this._id = _obj._id
      this.priority = _obj.priority
      this.domain = _obj.domain
      this.host = _obj.host
      this.port = _obj.port
      this.prefix = _obj.prefix
      this.enabled = _obj.enabled
      this.ssl = {
        cert: _obj.ssl.cert,
        key: _obj.ssl.key,
        ca: _obj.ssl.ca,
        force: _obj.ssl.force
      }
      this.pageId = _obj.pageId
    }
  }

  static operate (pageConfigs: PageConfig[]): void {
    let opt: http.RequestOptions = {
      host: _config.host,
      port: _config.port,
      path: '/' + _config.ns,
      method: 'POST',
      headers: {
        'Content-Type': 'application/nepq',
        'Authorization': 'Bearer ' + _config.token,
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
          if (res.statusCode !== 200) return
          try {
            let result = (<RouteConfig[]> JSON.parse(Buffer.concat(data).toString('utf8')))
              .map(x => new RouteConfig(x))
            _etag = res.headers['etag']

            // deep check and update
            _.forEach(pageConfigs, x => {
              if (_.isEmpty(x.domain)) return
              let route = _.find(result, y => y.pageId === x._id)
              if (!route) route = new RouteConfig(x, true)
              route.shouldDelete = false

              if (!route.valid(x)) {
                route.update(x)
              }
            })

            // delete not exists config
            let deleteIds = _(result).filter(x => x.shouldDelete).map(x => x._id).value()
            let opt: http.RequestOptions = {
              host: _config.host,
              port: _config.port,
              path: '/' + _config.ns,
              method: 'POST',
              headers: {
                'Content-Type': 'application/nepq',
                'Authorization': 'Bearer ' + _config.token
              }
            }
            let req = _http.request(opt)
            req.on('error', () => {})
            req.end(`delete configs(...${JSON.stringify(deleteIds)}){}`)
          } catch (e) {}
        })
    })
    req.on('error', () => {})
    req.end('list configs')
  }

  valid (page: PageConfig): boolean {
    if (!this._id) return false

    return this.priority === _config.config.priority &&
      _.isEqual(this.domain, page.domain) &&
      this.host === _config.config.host &&
      this.port === _config.config.port &&
      this.prefix === '/' + page.name &&
      this.enabled === page.ssl.enabled &&
      _.isEqual(this.ssl, {
          cert: page.ssl.cert,
          key: page.ssl.key,
          ca: page.ssl.ca,
          force: page.ssl.force
        }) &&
      this.pageId === page._id
  }

  update (page: PageConfig): void {
    // update route config
    let doc = {
      priority: _config.config.priority,
      domain: page.domain,
      host: _config.config.host,
      port: _config.config.port,
      prefix: '/' + page.name,
      enabled: page.ssl.enabled,
      ssl: {
        cert: page.ssl.cert,
        key: page.ssl.key,
        ca: page.ssl.ca,
        force: page.ssl.force
      },
      pageId: page._id
    }
    let opt: http.RequestOptions = {
      host: _config.host,
      port: _config.port,
      path: '/' + _config.ns,
      method: 'POST',
      headers: {
        'Content-Type': 'application/nepq',
        'Authorization': 'Bearer ' + _config.token
      }
    }
    let req = _http.request(opt, res => {})
    req.on('error', () => {})
    if (this._id) {
      req.write(`update configs("${this._id}",${JSON.stringify(doc)}){}`)
    } else {
      req.write(`create configs(${JSON.stringify(doc)}){}`)
    }
    req.end()
  }
}

export default RouteConfig
