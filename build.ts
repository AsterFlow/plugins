import { generateDtsBundle } from 'dts-bundle-generator'
import { existsSync } from 'fs'
import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { glob } from 'glob'
import JSON5 from 'json5'
import { dirname, join } from 'path'
import { build, type Options } from 'tsup'

/**
 * Interface para informações do pacote.
 */
interface PackageInfo {
  name: string
  version: string
  path: string
  publishPath: string
}

class PluginBuilder {
  private pluginsDir: string
  private publishDir: string
  private assetsToCopy: string[]
  private baseTsConfigPath: string
  private readonly CLI = '\x1b[34mCLI\x1b[0m'

  constructor(pluginsDir: string = 'plugins', publishDir: string = 'publish') {
    this.pluginsDir = pluginsDir
    this.publishDir = publishDir
    this.assetsToCopy = ['README.md', 'package.json']
    this.baseTsConfigPath = join(process.cwd(), pluginsDir, 'tsconfig.base.json')
  }

  /**
   * Executa o processo de build e publicação dos plugins.
   */
  async run(): Promise<void> {
    console.log(`${this.CLI} Starting plugin publishing process.`)
    await this.cleanPublishDir()

    const plugins = await glob(`${this.pluginsDir}/*/`)

    for (const pluginPath of plugins) {
      const pluginName = pluginPath.split('/').filter(Boolean).pop()
      if (!pluginName) continue

      console.log(`\n📦 Processing plugin: \x1b[33m${pluginName}\x1b[0m`)
      await this.processPlugin(pluginPath, pluginName)
      console.log(`  ✨ Done with ${pluginName}.`)
    }
    console.log(`\n${this.CLI} All plugins processed successfully.`)
  }

  /**
   * Limpa o diretório de publicação.
   */
  private async cleanPublishDir(): Promise<void> {
    if (existsSync(this.publishDir)) {
      console.log(`${this.CLI} Cleaning existing publish directory: ${this.publishDir}`)
      await rm(this.publishDir, { recursive: true })
    }
  }

  /**
   * Processa um único plugin: build, geração de DTS, mesclagem de tsconfig e cópia de assets.
   * @param pluginPath O caminho completo do diretório do plugin (ex: plugins/my-plugin).
   * @param pluginName O nome do plugin (ex: my-plugin).
   */
  private async processPlugin(pluginPath: string, pluginName: string): Promise<void> {
    const sharedConfig: Options = {
      platform: 'node',
      entry: [join(pluginPath, 'src/index.ts')],
      bundle: true,
      minifyIdentifiers: true,
      minifySyntax: true,
      skipNodeModulesBundle: true,
      clean: true,
      dts: false,
      tsconfig: 'tsconfig.json'
    }

    await this.buildPlugin(pluginName, sharedConfig)
    await this.generateDts(pluginPath, pluginName)

    const packageInfo = await this.readPackageInfo(pluginPath, pluginName)
    await this.mergeTsConfig(packageInfo)
    await this.copyAssets(pluginPath, pluginName, this.assetsToCopy)
  }

  /**
   * Realiza o build de um plugin para CJS e ESM.
   * @param pluginName O nome do plugin.
   * @param sharedConfig Configuração base do tsup.
   */
  private async buildPlugin(pluginName: string, sharedConfig: Options): Promise<void> {
    console.log(`  Building CJS for ${pluginName}...`)
    await build({
      ...sharedConfig,
      format: 'cjs',
      outDir: join(this.publishDir, pluginName, 'cjs')
    })

    console.log(`  Building ESM for ${pluginName}...`)
    await build({
      ...sharedConfig,
      format: 'esm',
      outDir: join(this.publishDir, pluginName, 'mjs'),
      splitting: true
    })

    await writeFile(join(this.publishDir, pluginName, 'cjs/package.json'), JSON.stringify({ type: 'commonjs' }, null, 2))
    await writeFile(join(this.publishDir, pluginName, 'mjs/package.json'), JSON.stringify({ type: 'module' }, null, 2))
  }

  /**
   * Gera os arquivos de declaração (.d.ts) para o plugin.
   * @param pluginPath O caminho completo do diretório do plugin.
   * @param pluginName O nome do plugin.
   */
  private async generateDts(pluginPath: string, pluginName: string): Promise<void> {
    console.log(`  Generating DTS for ${pluginName}...`)
    const dtsPath = join(process.cwd(), this.publishDir, pluginName, 'types/index.d.ts')
    const dtsCode = generateDtsBundle([{
      filePath: join(process.cwd(), pluginPath, 'src/index.ts'),
      output: {
        sortNodes: true,
        exportReferencedTypes: false,
        inlineDeclareExternals: true,
        inlineDeclareGlobals: true
      }
    }])

    await mkdir(dirname(dtsPath), { recursive: true })
    await writeFile(dtsPath, dtsCode.join('\n'), { encoding: 'utf-8' })
  }

  /**
   * Lê as informações do package.json de um plugin.
   * @param pluginPath O caminho completo do diretório do plugin.
   * @param pluginName O nome do plugin.
   * @returns As informações do pacote.
   */
  private async readPackageInfo(pluginPath: string, pluginName: string): Promise<PackageInfo> {
    const pluginPackageJsonPath = join(pluginPath, 'package.json')
    let pkgName = pluginName
    let pkgVersion = '0.0.0'

    if (existsSync(pluginPackageJsonPath)) {
      try {
        const pkgContent = await readFile(pluginPackageJsonPath, 'utf-8')
        const parsedPkg = JSON.parse(pkgContent)
        pkgName = parsedPkg.name || pkgName
        pkgVersion = parsedPkg.version || pkgVersion
      } catch (error) {
        console.error(`  \x1b[31mError:\x1b[0m Could not read package.json for ${pluginName}:`, error)
      }
    }

    return {
      name: pkgName,
      version: pkgVersion,
      path: pluginPath,
      publishPath: join(this.publishDir, pluginName)
    }
  }

  /**
   * Mescla o tsconfig.json base com o tsconfig.json do pacote e o salva no diretório de publicação.
   * @param packageInfo Informações do pacote para mesclar o tsconfig.
   */
  private async mergeTsConfig(packageInfo: PackageInfo): Promise<void> {
    const { path: packageSourcePath, publishPath } = packageInfo
    const packageConfigPath = join(packageSourcePath, 'tsconfig.json')

    if (!existsSync(packageConfigPath)) {
      console.warn(`${this.CLI} \x1b[33mWarning:\x1b[0m No tsconfig.json found for \x1b[36m${packageInfo.name}\x1b[0m at ${packageConfigPath}. Skipping tsconfig merge.`)
      return
    }

    console.log(`${this.CLI} Reading base tsconfig from ${this.baseTsConfigPath}`)
    let baseConfigContent: string
    try {
      baseConfigContent = await readFile(this.baseTsConfigPath, 'utf-8')
    } catch (error) {
      console.error(`${this.CLI} \x1b[31mError:\x1b[0m Could not read base tsconfig from ${this.baseTsConfigPath}:`, error)
      return
    }
    const baseConfig = JSON5.parse(baseConfigContent)

    console.log(`${this.CLI} Reading package tsconfig from ${packageConfigPath}`)
    const packageConfigContent = await readFile(packageConfigPath, 'utf-8')
    const packageConfig = JSON5.parse(packageConfigContent)

    delete packageConfig.extends

    const mergedConfig: any = {
      ...baseConfig,
      compilerOptions: {
        ...baseConfig.compilerOptions,
        ...(packageConfig.compilerOptions || {})
      },
      ...packageConfig
    }

    if (mergedConfig.compilerOptions) {
      delete mergedConfig.compilerOptions.baseUrl
      delete mergedConfig.compilerOptions.paths
    }

    mergedConfig.include = ['types']
    mergedConfig.exclude = ['node_modules', '**/*.spec.ts']

    if (mergedConfig.compilerOptions) {
      const typesPath = './types'
      mergedConfig.compilerOptions.paths = {
        [packageInfo.name]: [typesPath],
        [`${packageInfo.name}/*`]: [`${typesPath}/*`]
      }
      mergedConfig.compilerOptions.declaration = true
      mergedConfig.compilerOptions.declarationMap = true
    }

    const mergedConfigPath = join(publishPath, 'tsconfig.json')
    await mkdir(dirname(mergedConfigPath), { recursive: true })
    await writeFile(mergedConfigPath, JSON.stringify(mergedConfig, null, 2))
    console.log(`${this.CLI} Generated merged tsconfig at ${mergedConfigPath}`)
  }

  /**
   * Copia assets para o diretório de publicação do plugin.
   * @param sourcePath O caminho do diretório fonte do plugin.
   * @param targetDir O nome do diretório de destino dentro de 'publish'.
   * @param assets Uma lista de nomes de arquivos para copiar.
   */
  private async copyAssets(sourcePath: string, targetDir: string, assets: string[]): Promise<void> {
    for (const asset of assets) {
      const sourceFull = join(sourcePath, asset)
      const targetFull = join(this.publishDir, targetDir, asset)
      if (existsSync(sourceFull)) {
        console.log(`  Copying asset: ${asset}`)
        await cp(sourceFull, targetFull)
      } else {
        console.log(`  Skipping asset: ${asset} (not found at ${sourceFull})`)
      }
    }
  }
}

await new PluginBuilder().run()