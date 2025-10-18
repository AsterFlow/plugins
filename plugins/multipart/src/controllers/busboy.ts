import busboy from 'busboy'
import EventEmitter from 'events'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import type { IncomingMessage } from 'http'
import { dirname, extname, join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import {
  MultipartError,
  MultipartErrorCodes,
  type MultipartConfig,
  type MultipartFile,
  type MultipartResult,
  type ParserEvents,
  type ProcessedFile
} from '../types/multipart'
import { debug } from '../utils/log'

/**
 * ProcessedFile implementation compatible with Busboy
 */
export class BusboyProcessedFile implements ProcessedFile {
  fieldName: string
  filename: string
  encoding: string
  mimeType: string
  size: number
  buffer?: Buffer
  tempPath?: string
  extension?: string

  constructor(data: Omit<ProcessedFile, 'toBuffer' | 'save' | 'stream'>) {
    this.fieldName = data.fieldName
    this.filename = data.filename
    this.encoding = data.encoding
    this.mimeType = data.mimeType
    this.size = data.size
    this.buffer = data.buffer
    this.tempPath = data.tempPath
    this.extension = data.extension
  }

  async toBuffer(): Promise<Buffer> {
    if (this.buffer) {
      return this.buffer
    }
    
    if (this.tempPath) {
      return readFile(this.tempPath)
    }
    
    throw new Error('No data available')
  }

  async save(path: string): Promise<void> {
    const dir = dirname(path)
    await mkdir(dir, { recursive: true })
    
    if (this.buffer) {
      await writeFile(path, this.buffer)
    } else if (this.tempPath) {
      const source = createReadStream(this.tempPath)
      const dest = createWriteStream(path)
      await pipeline(source, dest)
    } else {
      throw new Error('No data available to save')
    }
  }

  stream(): NodeJS.ReadableStream {
    if (this.buffer) {
      const readable = new Readable()
      readable.push(this.buffer)
      readable.push(null)
      return readable
    }
    
    if (this.tempPath) {
      return createReadStream(this.tempPath)
    }
    
    throw new Error('No data available to stream')
  }
}

export class BusboyMultipartParser {
  private config: Required<MultipartConfig>
  private events: ParserEvents

  constructor(config: MultipartConfig = {}, events: ParserEvents = {}) {
    this.config = this.mergeDefaultConfig(config)
    this.events = events
  }

  /**
   * Processes a multipart request using Busboy
   */
  async parse(req: any): Promise<MultipartResult> {
    const startTime = Date.now()
    let bytesReceived = 0
    let fileCount = 0
    let fieldCount = 0
    
    debug('Starting Busboy parse with request:', typeof req, req.constructor?.name)
    
    try {
      // Adapts different request types to IncomingMessage
      const adaptedReq = this.adaptRequest(req)
      debug('Request adapted successfully')
      
      const { fields, files } = await this.processBusboyStream(adaptedReq, {
        onProgress: (bytes) => {
          bytesReceived += bytes
          this.events.onProgress?.(bytesReceived)
        },
        onFileProcessed: () => fileCount++,
        onFieldProcessed: () => fieldCount++
      })

      debug(`Busboy processing complete - ${fileCount} files, ${fieldCount} fields`)

      return {
        fields,
        files,
        metadata: {
          processingTime: Date.now() - startTime,
          totalSize: bytesReceived,
          fieldsCount: fieldCount,
          filesCount: fileCount
        }
      }
    } catch (error) {
      debug('Busboy parse error:', error)
      // Cleanup in case of error
      await this.cleanup()
      throw error
    }
  }

  /**
   * Processes stream using Busboy
   */
  private processBusboyStream(
    req: IncomingMessage, 
    callbacks: {
      onProgress: (bytes: number) => void;
      onFileProcessed: () => void;
      onFieldProcessed: () => void;
    }
  ): Promise<{ fields: Record<string, string | string[]>, files: ProcessedFile[] }> {
    return new Promise((resolve, reject) => {
      const bb = busboy({ 
        headers: req.headers, 
        limits: {
          fieldNameSize: this.config.limits.fieldNameSize,
          fieldSize: this.config.limits.fieldSize,
          fields: this.config.limits.fields,
          fileSize: this.config.limits.fileSize,
          files: this.config.limits.files,
          parts: this.config.limits.parts
        }
      })

      const fields: Record<string, string | string[]> = {}
      const files: ProcessedFile[] = []
      const tempFiles: string[] = []

      // Process text fields
      bb.on('field', (name, value) => {
        this.events.onField?.(name, value)
        
        if (fields[name]) {
          if (Array.isArray(fields[name])) {
            (fields[name] as string[]).push(value)
          } else {
            fields[name] = [fields[name] as string, value]
          }
        } else {
          fields[name] = value
        }
        
        callbacks.onFieldProcessed()
      })

      // Process files
      bb.on('file', async (name, stream, info) => {
        const { filename, encoding, mimeType } = info
        
        const multipartFile: MultipartFile = {
          fieldName: name,
          filename: filename || 'unknown',
          encoding,
          mimeType,
          stream,
          size: 0
        }

        // Validations
        const validation = await this.validateFile(multipartFile);
        if (!validation.valid) {
          stream.destroy();
          reject(validation.error!);
          return;
        }
        this.events.onFileStart?.(multipartFile)

        let fileSize = 0
        const chunks: Buffer[] = []

        stream.on('data', (chunk: Buffer) => {
          fileSize += chunk.length
          callbacks.onProgress(chunk.length)
          
          // Size validation
          if (fileSize > (this.config.limits?.fileSize || Infinity)) {
            stream.destroy()
            reject(new MultipartError('File size limit exceeded', MultipartErrorCodes.LIMIT_FILE_SIZE))
            return
          }

          this.events.onFileData?.(multipartFile, chunk)

          if (this.config.fileHandling.keepInMemory) {
            chunks.push(chunk)
          }
        })

        stream.on('end', async () => {
          try {
            let processedFile: ProcessedFile

            if (this.config.fileHandling.keepInMemory) {
              const buffer = Buffer.concat(chunks)
              processedFile = new BusboyProcessedFile({
                fieldName: name,
                filename: filename || 'unknown',
                encoding,
                mimeType,
                size: fileSize,
                buffer,
                extension: extname(filename || '')
              })
            } else {
              // Save to temporary file
              const tempPath = await this.saveTempFile(Buffer.concat(chunks))
              tempFiles.push(tempPath)
              
              processedFile = new BusboyProcessedFile({
                fieldName: name,
                filename: filename || 'unknown',
                encoding,
                mimeType,
                size: fileSize,
                tempPath,
                extension: extname(filename || '')
              })
            }

            // Custom handler
            if (this.config.fileHandling?.fileHandler) {
              processedFile = await this.config.fileHandling.fileHandler(multipartFile)
            }

            files.push(processedFile)
            this.events.onFileEnd?.(processedFile)
            callbacks.onFileProcessed()
          } catch (error) {
            reject(error)
          }
        })

        stream.on('error', (error: Error) => {
          this.events.onError?.(error)
          reject(error)
        })
      })

      bb.on('close', () => {
        resolve({ fields, files })
      })

      bb.on('error', (error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        this.events.onError?.(err)
        reject(err)
      })

      // Connect the stream
      req.pipe(bb)
    })
  }

  /**
   * Adapts different request types to IncomingMessage
   */
  private adaptRequest(req: any): IncomingMessage {
    debug('Adapting request type:', typeof req, req.constructor?.name)
    
    // 1. Node.js - req is already IncomingMessage
    if (req.headers && req.pipe && typeof req.on === 'function' && !req.headers.forEach) {
      debug('Direct Node.js IncomingMessage detected')
      return req as IncomingMessage
    }

    // 2. Express - req is Express.Request, get req.req
    if (req.req && req.req.headers && req.req.pipe && typeof req.req.on === 'function') {
      debug('Express Request detected, using req.req')
      return req.req as IncomingMessage
    }

    // 3. Fastify - req is FastifyRequest, get req.raw  
    if (req.raw && req.raw.headers && req.raw.pipe && typeof req.raw.on === 'function') {
      debug('Fastify Request detected, using req.raw')
      return req.raw as IncomingMessage
    }

    // 4. Bun/Web API - req is Request, needs conversion
    if (req.headers && typeof req.headers.forEach === 'function') {
      debug('Web API Request detected, converting to stream')
      return this.convertWebRequestToIncomingMessage(req)
    }

    // 5. AsterFlow Request wrapper - get the .raw
    if (req.raw) {
      debug('AsterFlow Request wrapper detected, extracting .raw')
      return this.adaptRequest(req.raw)
    }

    debug('Unsupported request type:', req)
    throw new Error(`Unsupported request type for Busboy: ${typeof req} ${req.constructor?.name}`)
  }

  /**
   * Converts Web API Request to a mock IncomingMessage compatible with Busboy
   */
  private convertWebRequestToIncomingMessage(webRequest: Request): IncomingMessage {
    // Create a mock IncomingMessage
    const mockIncomingMessage = new EventEmitter() as any

    // Headers from Web API Request to Node.js format
    const headers: Record<string, string | string[]> = {}
    webRequest.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    // Basic properties
    mockIncomingMessage.headers = headers
    mockIncomingMessage.method = webRequest.method
    mockIncomingMessage.url = webRequest.url
    mockIncomingMessage.httpVersion = '1.1'
    mockIncomingMessage.httpVersionMajor = 1
    mockIncomingMessage.httpVersionMinor = 1

    // Readable stream properties
    mockIncomingMessage.readable = true
    mockIncomingMessage.readableEnded = false
    mockIncomingMessage.destroyed = false

    // Mock pipe method
    mockIncomingMessage.pipe = function(destination: any) {
      debug('Piping Web API Request body to Busboy')
      
      // Convert ReadableStream to Node.js stream
      if (webRequest.body) {
        const reader = webRequest.body.getReader()
        
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              
              const buffer = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(value)
              destination.write(buffer)
            }
            destination.end()
          } catch (error) {
            destination.destroy(error)
          } finally {
            reader.releaseLock()
          }
        }

        // Start async pump
        pump()
      } else {
        // No body, end immediately
        destination.end()
      }

      return destination
    }

    // Mock events for compatibility
    setTimeout(() => {
      if (webRequest.body) {
        mockIncomingMessage.emit('readable')
      } else {
        mockIncomingMessage.emit('end')
      }
    }, 0)

    return mockIncomingMessage
  }

  /**
   * Validates file
   */
  private async validateFile(file: MultipartFile): Promise<{ valid: boolean; error?: MultipartError }> {
    const { validation } = this.config;
    
    try {
      if (validation?.allowedMimeTypes && validation.allowedMimeTypes.length > 0) {
        if (!validation.allowedMimeTypes.includes(file.mimeType)) {
          return {
            valid: false,
            error: new MultipartError(`MIME type ${file.mimeType} not allowed`, MultipartErrorCodes.INVALID_MIME_TYPE)
          };
        }
      }

      if (validation?.allowedExtensions && validation.allowedExtensions.length > 0) {
        const ext = extname(file.filename).toLowerCase();
        if (!validation.allowedExtensions.includes(ext)) {
          return {
            valid: false,
            error: new MultipartError(`Extension ${ext} not allowed`, MultipartErrorCodes.INVALID_EXTENSION)
          };
        }
      }

      if (validation?.validator) {
        const isValid = await validation.validator(file);
        if (!isValid) {
          return {
            valid: false,
            error: new MultipartError('File validation failed', MultipartErrorCodes.VALIDATION_FAILED)
          };
        }
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: new MultipartError(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`, MultipartErrorCodes.VALIDATION_FAILED)
      };
    }
  }

  /**
   * Saves temporary file
   */
  private async saveTempFile(data: Buffer): Promise<string> {
    const tempDir = this.config.fileHandling.tempDir || '/tmp'
    await mkdir(tempDir, { recursive: true })
    
    const filename = `asterflow-busboy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const tempPath = join(tempDir, filename)
    
    await writeFile(tempPath, data)
    return tempPath
  }

  /**
   * Merges default configuration
   */
  private mergeDefaultConfig(config: MultipartConfig): Required<MultipartConfig> {
    return {
      limits: {
        fieldNameSize: 100,
        fieldSize: 1024 * 1024, // 1MB
        fields: Infinity,
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 10,
        parts: Infinity,
        ...config.limits
      },
      fileHandling: {
        keepInMemory: true,
        tempDir: '/tmp',
        fileHandler: undefined,
        ...config.fileHandling
      },
      validation: {
        allowedMimeTypes: [],
        allowedExtensions: [],
        validator: undefined,
        ...config.validation
      }
    }
  }
}

/**
 * Helper function for direct multipart parsing with Busboy
 * 
 * @param req Request object (any supported format)
 * @param config Optional multipart configuration
 * @param events Optional events for monitoring
 * @returns Promise with processing result
 */
export async function parseMultipartBusboy(
  req: any, 
  config?: MultipartConfig,
  events?: ParserEvents
): Promise<MultipartResult> {
  const parser = new BusboyMultipartParser(config, events)
  return parser.parse(req)
}
