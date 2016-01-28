import * as http from 'http'
import * as https from 'https'
import * as path from 'path'
import * as fs from 'fs'
import * as _ from 'lodash'
import * as mkdirp from 'mkdirp'
import config from '../config'
import PageConfig from './page-config'

const _http = config.db.protocol === 'https' ? https : http

function decode (base64: string): string {
  return base64 ? new Buffer(base64, 'base64').toString() : null
}

interface FileConfig {
  _id: string
  pageId: string
  name: string
  path: string // reject reletive path
  data: string // base64
  op: string
}

class FileConfig {
  pageName: string

  constructor (obj: FileConfig) {
    this._id = obj._id || ''
    this.pageId = obj.pageId || ''
    this.name = obj.name || ''
    this.path = obj.path || ''
    this.data = obj.data || ''
    this.op = obj.op || ''
  }

  get valid (): boolean {
    return !!this._id && !!this.pageId && !!this.name && !!this.path && !!this.op && !!this.pageName
  }

  error (): void {
    let opt: http.RequestOptions = {
      host: config.db.host,
      port: config.db.port,
      path: '/' + config.db.ns,
      method: 'POST',
      headers: {
        'Content-Type': 'application/nepq',
        'Authorization': 'Bearer ' + config.db.token
      }
    }
    let req = _http.request(opt)
    req.on('error', () => {})
    req.end(`update files("${this._id}",{op:"error"}){}`)
  }

  delete (): void {
    if (!path.isAbsolute(this.path)) return this.error()

    fs.unlink(path.join(config.pagesDir, this.pageName, this.path, this.name), err => {
      this.data = undefined
      if (err && err.errno !== -4058) return this.error()

      // just remove if empty
      fs.rmdir(path.join(config.pagesDir, this.pageName, this.path), () => {})

      let opt: http.RequestOptions = {
        host: config.db.host,
        port: config.db.port,
        path: '/' + config.db.ns,
        method: 'POST',
        headers: {
          'Content-Type': 'application/nepq',
          'Authorization': 'Bearer ' + config.db.token
        }
      }
      let req = _http.request(opt, res => {
        res.on('end', () => {})
      })
      req.on('error', () => {})
      req.end(`delete files("${this._id}"){}`)
    })
  }

  update (): void {
    this.data = decode(this.data)
    if (!path.isAbsolute(this.path) || _.isNull(this.data)) return this.error()

    mkdirp(path.join(config.pagesDir, this.pageName, this.path), err => {
      if (err) {
        this.data = undefined
        return this.error()
      }
      fs.writeFile(path.join(config.pagesDir, this.pageName, this.path, this.name), this.data, err => {
        this.data = undefined
        if (err) return this.error()

        let opt: http.RequestOptions = {
          host: config.db.host,
          port: config.db.port,
          path: '/' + config.db.ns,
          method: 'POST',
          headers: {
            'Content-Type': 'application/nepq',
            'Authorization': 'Bearer ' + config.db.token
          }
        }
        let req = _http.request(opt)
        req.on('error', () => {})
        req.end(`update files("${this._id}",{},["data", "op"]){}`)
      })
    })
  }

  static operate (pages: PageConfig[]): void {
    let opt: http.RequestOptions = {
      host: config.db.host,
      port: config.db.port,
      path: '/' + config.db.ns,
      method: 'POST',
      headers: {
        'Content-Type': 'application/nepq',
        'Authorization': 'Bearer ' + config.db.token
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
            ;_(<FileConfig[]> JSON.parse(Buffer.concat(data).toString('utf8')))
              .map(x => new FileConfig(x))
              .forEach(x => {
                let p = _.find(pages, p => p._id === x.pageId)
                if (p) x.pageName = p.name
                if (!x.valid) return x.error()
                if (x.op === 'update') return x.update()
                if (x.op === 'delete') return x.delete()
                x.error()
              })
          } catch (e) {}
        })
    })
    req.on('error', () => {})
    req.end('query files(op:{$in:["update","delete"]}){_id,pageId,name,path,data,op}')
  }
}

export default FileConfig
