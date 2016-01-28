import * as express from 'express'
import * as path from 'path'
import * as url from 'url'
import * as fs from 'fs'
import * as _ from 'lodash'
import { Observable, Observer } from 'rxjs'
import appConfig from './config'
import PageConfig from './lib/page-config'
import RouteConfig from './lib/route-config'
import FileConfig from './lib/file-config'

let configs: PageConfig[] = []

reloadPageConfig()
operateFileConfig()

let patch: Observer<{}>
const observable = (<Observable<{}>> Observable.create((observer: Observer<{}>) => { patch = observer })).share()

observable
  .filter(x => x === 1)
  .debounceTime(appConfig.debounce)
  .subscribe(() => {
    reloadPageConfig()
  })

observable
  .filter(x => x === 2)
  .debounceTime(appConfig.debounce)
  .subscribe(() => {
    operateFileConfig()
  })

setInterval(() => { patch.next(1); patch.next(2) }, appConfig.interval)

const app = express()
app.disable('x-powered-by')

app.patch('/route', (req, res) => {
  patch.next(1)
  res.sendStatus(200)
})

app.patch('/file', (req, res) => {
  patch.next(2)
  res.sendStatus(200)
})

app.use((req, res, next) => {
  // find PageConfig from request
  let u = url.parse(req.url)
  let q = u.pathname.split('/')
  q.shift()
  let [ name ] = q

  let c = _.find(configs, x => x.name === name)
  if (_.isNil(c)) {
    // no config => local
    req.url = `/local${req.url}`
    return next()
  }

  // is not allow local and from local, reject 404
  let local = _.some(appConfig.hostname, x => x === req.hostname)
  if (!c.local && local) return res.sendStatus(404)

  // check fallback and file exists
  if (c.fallback && !fs.existsSync(path.join(__dirname, appConfig.pagesDir, u.pathname))) {
    req.url = `/${name}/${c.fallback}`
  }

  next()
})

app.use(express.static(path.join(__dirname, appConfig.pagesDir)))
app.use((req, res) => { res.sendStatus(404) })
app.listen(appConfig.port)

function reloadPageConfig (): void {
  PageConfig.load((err, result) => {
    if (err || !result) return // skip error
    configs = result
    RouteConfig.operate(result)
  })
}

function operateFileConfig (): void {
  let pageConfigs = configs
  if (_.isEmpty(pageConfigs)) return
  FileConfig.operate(pageConfigs)
}
