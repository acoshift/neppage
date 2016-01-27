import * as express from 'express'
import * as path from 'path'
import * as url from 'url'
import * as fs from 'fs'
import * as _ from 'lodash'
import appConfig from './config'
import PageConfig from './lib/page-config'
import RouteConfig from './lib/route-config'

/* FileConfig
 * Operator
 * 1. Read file configs from db
 * 2. Write data to file in pagesDir
 * 3. Remove writed file configs from db
*/
interface FileConfig {
  _id: string
  pageId: string
  name: string
  path: string // reject reletive path
  data: string // base64
}

const app = express()
app.disable('x-powered-by')

let configs: PageConfig[] = []

function reloadPageConfig (): void {
  PageConfig.load((err, result) => {
    if (err || !result) return // skip error
    configs = result
    RouteConfig.operate(result)
  })
};

setInterval(reloadPageConfig, appConfig.interval)
reloadPageConfig()

function operateFileConfig (): void {
  let pageConfigs = configs
  if (_.isEmpty(pageConfigs)) return

}

setInterval(operateFileConfig, appConfig.operateFileInterval)

app.use((req, res, next) => {
  // find PageConfig from request
  let u = url.parse(req.url)
  let q = u.pathname.split('/')
  q.shift()
  let [ name ] = q

  let c = _.find(configs, x => x.name === name)
  if (!c) {
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
