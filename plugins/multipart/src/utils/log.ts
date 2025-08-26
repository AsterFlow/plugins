const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  blue: '\x1b[34m'
}

export function debug(...args: any[]) {
  if (process.env.DEBUG === 'true') {
    console.log(`${colors.blue}[AsterFlow Debug]${colors.reset}`, ...args)
  }
}

export function logError(title: string, error: any) {
  console.error(`${colors.red}%s %s${colors.reset}`, '[AsterFlow Multipart Busboy]', title)
  console.group()
  console.error('Error:', error.message)
  if (error.code) console.error('Code:', error.code)
  if (error.details) console.error('Details:', error.details)
  console.groupEnd()
  console.log()
}