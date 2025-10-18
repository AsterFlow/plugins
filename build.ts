// build.ts

import { exec } from 'child_process'
import { generateDtsBundle } from 'dts-bundle-generator'
import { existsSync } from 'fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { glob } from 'glob'
import JSON5 from 'json5'
import { dirname, join } from 'path'
import { build, type Options } from 'tsup'
import { promisify } from 'util'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const execAsync = promisify(exec)

interface PackageInfo {
  name: string
  version: string
  path: string
  publishPath: string
}

interface PackageJson {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: any
}

class PluginBuilder {
  private pluginsDir: string
  private publishDir: string
  private assetsToCopy: string[]
  private baseTsConfigPath: string
  private readonly CLI = '\x1b[34mCLI\x1b[0m'
  private rootPackageJson: PackageJson = {}

  constructor(pluginsDir: string = 'plugins', publishDir: string = 'publish') {
    this.pluginsDir = pluginsDir
    this.publishDir = publishDir
    this.assetsToCopy = ['README.md']
    this.baseTsConfigPath = join(process.cwd(), pluginsDir, 'tsconfig.base.json')
  }

  async run(packageName?: string, isLocalPublish: boolean = false): Promise<void> {
    const action = isLocalPublish ? 'local packaging' : 'publishing'
    console.log(`${this.CLI} Starting plugin ${action} process.`)

    await this.cleanPublishDir()
    await this.loadRootPackageJson()

    let plugins: string[]

    if (packageName) {
      const specificPluginPath = join(this.pluginsDir, packageName, '/')
      if (!existsSync(specificPluginPath)) {
        console.error(`\x1b[31mError:\x1b[0m Pacote '${packageName}' não encontrado em ${specificPluginPath}`)
        process.exit(1)
      }
      plugins = [specificPluginPath]
      console.log(`${this.CLI} Processando apenas o pacote: \x1b[36m${packageName}\x1b[0m`)
    } else {
      plugins = await glob(`${this.pluginsDir}/*/`)
      console.log(`${this.CLI} Processando todos os pacotes.`)
    }

    for (const pluginPath of plugins) {
      const pluginName = pluginPath.split('/').filter(Boolean).pop()
      if (!pluginName) continue

      console.log(`\n📦 Processing plugin: \x1b[33m${pluginName}\x1b[0m`)
      const packageInfo = await this.processPlugin(pluginPath, pluginName)

      if (isLocalPublish && packageInfo) {
        await this.packPluginForLocalInstall(packageInfo)
      }

      console.log(`  ✨ Done with ${pluginName}.`)
    }
    console.log(`\n${this.CLI} All plugins processed successfully.`)
  }

  private async cleanPublishDir(): Promise<void> {
    if (existsSync(this.publishDir)) {
      console.log(`${this.CLI} Cleaning existing publish directory: ${this.publishDir}`)
      await rm(this.publishDir, { recursive: true })
    }
  }

  private async processPlugin(pluginPath: string, pluginName: string): Promise<PackageInfo | undefined> {
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
    await this.processPackageJson(pluginPath, pluginName)
    await this.mergeTsConfig(packageInfo)
    await this.copyAssets(pluginPath, pluginName, this.assetsToCopy)

    return packageInfo
  }

  private async buildPlugin(pluginName: string, sharedConfig: Options): Promise<void> {
    console.log(`  Building CJS for ${pluginName}...`)
    await build({
      ...sharedConfig,
      format: 'cjs',
      outDir: join(this.publishDir, pluginName, 'dist', 'cjs')
    })

    console.log(`  Building ESM for ${pluginName}...`)
    await build({
      ...sharedConfig,
      format: 'esm',
      outDir: join(this.publishDir, pluginName, 'dist', 'mjs'),
      splitting: true
    })

    await writeFile(join(this.publishDir, pluginName, 'dist/cjs/package.json'), JSON.stringify({ type: 'commonjs' }, null, 2))
    await writeFile(join(this.publishDir, pluginName, 'dist/mjs/package.json'), JSON.stringify({ type: 'module' }, null, 2))
  }

  private async generateDts(pluginPath: string, pluginName: string): Promise<void> {
    console.log(`  Generating DTS for ${pluginName}...`)
    const dtsPath = join(process.cwd(), this.publishDir, pluginName, 'dist', 'types/index.d.ts')
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

  private async loadRootPackageJson(): Promise<void> {
    const rootPackageJsonPath = join(process.cwd(), 'package.json')
    console.log(`${this.CLI} Reading root package.json from ${rootPackageJsonPath}`)
    try {
      const content = await readFile(rootPackageJsonPath, 'utf-8')
      this.rootPackageJson = JSON.parse(content)
    } catch (error) {
      console.warn(`${this.CLI} \x1b[33mWarning:\x1b[0m Could not read or parse root package.json. Global dependencies will not be merged.`, error)
      this.rootPackageJson = {}
    }
  }

  private async processPackageJson(pluginPath: string, pluginName: string): Promise<void> {
    const pluginPackageJsonPath = join(pluginPath, 'package.json')
    if (!existsSync(pluginPackageJsonPath)) {
      console.log(`  Skipping package.json processing: file not found at ${pluginPackageJsonPath}`)
      return
    }

    console.log(`  Processing package.json for ${pluginName}...`)
    const pluginPkgContent = await readFile(pluginPackageJsonPath, 'utf-8')
    const pluginPkg: PackageJson = JSON.parse(pluginPkgContent)
    const mergedDependencies = {
      ...(this.rootPackageJson.dependencies || {}),
      ...(pluginPkg.dependencies || {})
    }
    const finalPkg = { ...pluginPkg, dependencies: mergedDependencies }
    const targetPath = join(this.publishDir, pluginName, 'package.json')
    await writeFile(targetPath, JSON.stringify(finalPkg, null, 2))
    console.log(`  Generated merged package.json at ${targetPath}`)
  }

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

  private async copyAssets(sourcePath: string, targetDir: string, assets: string[]): Promise<void> {
    for (const asset of assets) {
      const sourceFull = join(sourcePath, asset)
      const targetFull = join(this.publishDir, targetDir, asset)
      if (existsSync(sourceFull)) {
        console.log(`  Copying asset: ${asset}`)
        await mkdir(dirname(targetFull), { recursive: true })
        await cp(sourceFull, targetFull)
      } else {
        console.log(`  Skipping asset: ${asset} (not found at ${sourceFull})`)
      }
    }
  }

  private async packPluginForLocalInstall(packageInfo: PackageInfo): Promise<void> {
    console.log(`  🥡 Packing ${packageInfo.name} for local installation...`)
    const publishPath = join(process.cwd(), packageInfo.publishPath)

    try {
      const { stdout } = await execAsync('bun pm pack', { cwd: publishPath })

      // **LÓGICA CORRIGIDA**: Extrai apenas a linha com o nome do arquivo .tgz
      const tgzFileName = stdout
        .split('\n') // 1. Divide a saída em um array de linhas
        .find(line => line.endsWith('.tgz')) // 2. Encontra a linha que termina com .tgz
        ?.trim() // 3. Remove espaços em branco extras (o ?. é para segurança)

      if (!tgzFileName) {
        throw new Error(`Could not determine packed file name from \`bun pm pack\` output.\nReceived: ${stdout}`)
      }

      const sourceTgzPath = join(publishPath, tgzFileName)
      const localPackagesDir = join(process.cwd(), 'local-packages')
      await mkdir(localPackagesDir, { recursive: true })
      const targetTgzPath = join(localPackagesDir, tgzFileName)

      await rename(sourceTgzPath, targetTgzPath)

      console.log(`  ✅ Packed successfully!`)
      console.log(`  📂 File created: \x1b[32m${targetTgzPath}\x1b[0m`)
      console.log(`  💡 To install, run: \x1b[36mbun add ${targetTgzPath}\x1b[0m`)
    } catch (error) {
      console.error(`  \x1b[31mError:\x1b[0m Failed to pack ${packageInfo.name}.`, error)
    }
  }
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .options({
      package: {
        alias: 'p',
        type: 'string',
        describe: 'Nome do pacote específico para processar (ex: fs, multipart)',
        demandOption: false
      },
      local: {
        type: 'boolean',
        describe: 'Gera um pacote .tgz para instalação local em vez de publicar.',
        default: false
      }
    })
    .help()
    .parse()

  const builder = new PluginBuilder()
  await builder.run(argv.package as string, argv.local)
}

main().catch((error) => {
  console.error('Erro durante o processo:', error)
  process.exit(1)
})