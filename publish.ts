import { glob } from 'glob'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { inc } from 'semver'
import { exec } from 'child_process'
import { promisify } from 'util'

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
      await execAsync('npm publish --access public', {
        cwd: join('publish', pkgPath.split('/').pop() || '')
      })
      
      console.log(`${this.PUBLISH} ${pkg.name}@${pkg.version} publicado com sucesso!`)
    } catch (error) {
      console.error(`${this.PUBLISH} Falha ao publicar ${pkgPath}:`, error)
      throw error
    }
  }

  public async publish(): Promise<void> {
    try {
      // Primeiro atualiza todas as versões
      const packages = await glob(['plugins/*/'])
      console.log(`${this.CLI} Pacotes encontrados:`, packages)

      for (const pkg of packages) {
        await this.updateVersion(join(pkg, 'package.json'))
      }

      // Executa o build para garantir que tudo está atualizado
      console.log(`${this.CLI} Executando build...`)
      await execAsync('bun run build')
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

// Execute publish
const publisher = new Publisher()
publisher.publish().catch(console.error)