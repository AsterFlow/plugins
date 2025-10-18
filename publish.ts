import { glob } from 'glob'
import { readFile, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { inc } from 'semver'
import { exec } from 'child_process'
import { promisify } from 'util'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const execAsync = promisify(exec)

class Publisher {
  private readonly CLI = '\x1b[34mCLI\x1b[0m'
  private readonly VERSION = '\x1b[32mVERSION\x1b[0m'
  private readonly PUBLISH = '\x1b[35mPUBLISH\x1b[0m'

  constructor() {}

  private async updateVersion(pkgPath: string): Promise<void> {
    const content = await readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(content)
    
    // Incrementa a versão patch usando semver
    const newVersion = inc(pkg.version, 'patch')
    if (!newVersion) {
      throw new Error(`Falha ao incrementar a versão para ${pkgPath}`)
    }

    console.log(`${this.VERSION} Atualizando ${pkg.name} de ${pkg.version} para ${newVersion}`)
    pkg.version = newVersion

    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`${this.VERSION} ${pkgPath} atualizado.`)
  }

  private async publishPackage(pkgPath: string): Promise<void> {
    try {
      const content = await readFile(join(pkgPath, 'package.json'), 'utf-8')
      const pkg = JSON.parse(content)
      
      console.log(`${this.PUBLISH} Publicando ${pkg.name}@${pkg.version}`)
      
      // Executa npm publish na pasta publish/[package]
      const packageName = pkgPath.split('/').filter(Boolean).pop() || ''
      const publishDir = join('publish', packageName)
      
      if (!existsSync(publishDir)) {
        throw new Error(`Diretório de publicação não encontrado: ${publishDir}`)
      }
      
      console.log(`${this.PUBLISH} Executando npm publish em: ${publishDir}`)
      
      await execAsync('npm publish --access public', {
        cwd: publishDir
      })
      
      console.log(`${this.PUBLISH} ${pkg.name}@${pkg.version} publicado com sucesso!`)
    } catch (error) {
      console.error(`${this.PUBLISH} Falha ao publicar ${pkgPath}:`, error)
      throw error
    }
  }

  public async publish(packageName?: string): Promise<void> {
    try {
      let packages: string[]
      
      if (packageName) {
        // Processar apenas o pacote específico
        const specificPackagePath = `plugins/${packageName}/`
        if (!existsSync(specificPackagePath)) {
          console.error(`\x1b[31mError:\x1b[0m Pacote '${packageName}' não encontrado em ${specificPackagePath}`)
          process.exit(1)
        }
        packages = [specificPackagePath]
        console.log(`${this.CLI} Processando apenas o pacote: \x1b[36m${packageName}\x1b[0m`)
      } else {
        // Processar todos os pacotes
        packages = await glob(['plugins/*/'])
        console.log(`${this.CLI} Processando todos os pacotes.`)
      }
      
      console.log(`${this.CLI} Pacotes encontrados:`, packages)

      for (const pkg of packages) {
        await this.updateVersion(join(pkg, 'package.json'))
      }

      // Executa o build para garantir que tudo está atualizado
      console.log(`${this.CLI} Executando build...`)
      if (packageName) {
        await execAsync(`bun run build --package ${packageName}`)
      } else {
        await execAsync('bun run build')
      }
      console.log(`${this.CLI} Build concluído.`)

      // Publica os pacotes
      for (const pkg of packages) {
        await this.publishPackage(pkg)
      }

      console.log(`${this.CLI} Todos os pacotes foram publicados com sucesso!`)
    } catch (error) {
      console.error(`${this.CLI} Falha ao publicar pacotes:`, error)
      process.exit(1)
    }
  }
}

// Main execution function
async function main() {
  // Parse command line arguments
  const argv = await yargs(hideBin(process.argv))
    .options({
      'package': {
        alias: 'p',
        type: 'string',
        describe: 'Nome do pacote específico para publicar (ex: fs, multipart)',
        demandOption: false
      }
    })
    .help()
    .parse()

  // Execute publish
  const publisher = new Publisher()
  await publisher.publish(argv.package)
}

// Execute main function
main().catch((error) => {
  console.error('Erro durante a publicação:', error)
  process.exit(1)
})