import type { AsterFlow } from '@asterflow/core'
import { Plugin } from '@asterflow/plugin'
import { Method, Router, type AnyRouter } from '@asterflow/router'
import { Analyze } from '@asterflow/url-parser'
import * as pkg from '../package.json'
import { transformPathToUrl } from './utils/format'
import { getFilesRecursively } from './utils/glob'

export * from './utils/format'
export * from './utils/glob'

export type FSRoutingContext = {
  path: string
  files: string[]
  creator: string,
  version: string,
}

export const fsRoutingPlugin = Plugin
  .instance<AsterFlow>()
  .create({ name: 'fs-routing' })
  .decorate('creator', 'Ashu11-A')
  .decorate('version', pkg.version) 
  .config({ path: '' })
  .derive('files', async (context) => await getFilesRecursively(context.path))
  .extends((instance) => ({
    async registerRoutes (context: FSRoutingContext) {
      if (context.files.length === 0) return

      for (const file of context.files) {
        const routeModule = await import(file) as { default?: AnyRouter }
        const exported = routeModule.default
        if (
          !exported || !(exported instanceof Method || exported instanceof Router)
        ) continue
        
        const path = transformPathToUrl(file, context.path)
        exported.path = path
        exported.url = new Analyze(path)

        instance.controller(exported)
      }
    }
  }))
  .on('beforeInitialize', async (instance, context) => await instance.registerRoutes(context))

export default fsRoutingPlugin