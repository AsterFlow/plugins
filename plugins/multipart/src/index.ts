import { Plugin } from '@asterflow/plugin'
import { unlink } from 'fs/promises'
import * as pkg from '../package.json'
import { BusboyMultipartParser } from './controllers/busboy'
import { MultipartError, MultipartErrorCodes, type MultipartConfig, type MultipartResult, type ParserEvents } from './types/multipart'
import { debug, logError } from './utils/log'

export * from './controllers/busboy'
export * from './types/asterflow.d'
export * from './types/multipart'

export const multipartPlugin = Plugin
  .create({ name: 'multipart' })
  .decorate('creator', 'Ashu11-a')
  .decorate('version', pkg.version)
  .decorate('parser', 'busboy')
  
  // Default configuration
  .config<MultipartConfig>({
    limits: {
      fieldNameSize: 100,
      fieldSize: 1024 * 1024, // 1MB
      fields: Infinity,
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 10,
      parts: Infinity
    },
    fileHandling: {
      keepInMemory: true,
      tempDir: '/tmp'
    },
    validation: {
      allowedMimeTypes: [],
      allowedExtensions: []
    }
  })

  // Derive parser
  .derive('parser', async (context) => {
    return new BusboyMultipartParser(context as MultipartConfig)
  })

  // Derive parsing function
  .derive('parseRequest', (context) => {
    return async (request: any): Promise<MultipartResult> => {
      const events: ParserEvents = {
        // onProgress: (_bytes) => {},
        onFileStart: (file) => {
          debug('File Upload Started (Busboy)', {
            'Field Name': file.fieldName,
            'Filename': file.filename,
            'MIME Type': file.mimeType,
            'Encoding': file.encoding
          })
        },
        onFileEnd: (file) => {
          debug('File Upload Completed (Busboy)', {
            'Field Name': file.fieldName,
            'Filename': file.filename,
            'Size': `${file.size} bytes`,
            'Storage': file.buffer ? 'Memory' : 'Temporary File'
          })
        },
        onError: (error) => {
          logError('Busboy Parse Error', error)
        }
      }

      debug('Creating Busboy parser for request type:', typeof request.raw)
      const parser = new BusboyMultipartParser(context as MultipartConfig, events)
      
      // Pass request.raw which contains the original request from the adapter
      return parser.parse(request.raw)
    }
  })

  // Extend instance with utility methods
  .extends((instance, context) => ({
    async parseMultipart(request: any): Promise<MultipartResult> {
      return context.parseRequest(request)
    },

    onMultipartEvent(events: Partial<ParserEvents>) {
      Object.assign(context, events)
      return instance
    },

    async cleanupMultipart(result: MultipartResult): Promise<void> {
      if (!context.fileHandling?.keepInMemory) {
        
        for (const file of result.files) {
          if (file.tempPath) {
            try {
              await unlink(file.tempPath)
            } catch {
              // Ignore errors
            }
          }
        }
      }
    }
  }))

  // Main hook - automatically processes multipart requests
  .on('onRequest', async ({ request, response, context }) => {
    const headers = request.getHeaders()
    const contentType = headers['content-type'] || headers['Content-Type']
    
    if (!contentType || !contentType.toLowerCase().trim().startsWith('multipart/form-data')) {
      return
    }

    try {
      debug('Processing Multipart Request (Busboy)', {
        'Content-Type': contentType,
        'Method': request.getMethod(),
        'Path': request.getPathname()
      })

      const result = await context.parseRequest(request)

      // Extend request with processed data and utility methods
      const extendedRequest = request.extend({
        body: result.fields,
        files: result.files,
        multipart: {
          metadata: result.metadata,
          fields: result.fields,
          files: result.files,
          
          getFile: (fieldName: string) => result.files.find(file => file.fieldName === fieldName),
          getFiles: (fieldName?: string) => fieldName ? result.files.filter(file => file.fieldName === fieldName) : result.files,
          hasFiles: () => result.files.length > 0,
          getFilesByType: (mimeType: string) => result.files.filter(file => file.mimeType === mimeType),
          
          async saveAll(directory: string): Promise<string[]> {
            const paths: string[] = []
            for (const file of result.files) {
              const path = `${directory}/${file.filename}`
              await file.save(path)
              paths.push(path)
            }
            return paths
          }
        }
      })

      Object.assign(request, extendedRequest)

      debug('Multipart Processing Complete (Busboy)', {
        'Fields': String(result.metadata.fieldsCount),
        'Files': String(result.metadata.filesCount),
        'Total Size': `${result.metadata.totalSize} bytes`,
        'Processing Time': `${result.metadata.processingTime}ms`
      })

    } catch (error) {
      logError('Multipart Processing Failed (Busboy)', error)

      if (error instanceof MultipartError) {
        // Map error codes to appropriate HTTP status
        const statusMap = {
          [MultipartErrorCodes.LIMIT_FILE_SIZE]: 413, // Payload Too Large
          [MultipartErrorCodes.LIMIT_FILE_COUNT]: 413,
          [MultipartErrorCodes.LIMIT_FIELD_SIZE]: 413,
          [MultipartErrorCodes.LIMIT_FIELD_COUNT]: 413,
          [MultipartErrorCodes.LIMIT_PARTS]: 413,
          [MultipartErrorCodes.INVALID_MIME_TYPE]: 415, // Unsupported Media Type
          [MultipartErrorCodes.INVALID_EXTENSION]: 415,
          [MultipartErrorCodes.VALIDATION_FAILED]: 422, // Unprocessable Entity
          [MultipartErrorCodes.PARSE_ERROR]: 400 // Bad Request
        }

        const statusCode = statusMap[error.code as keyof typeof statusMap] || 400
        
        if (statusCode === 413) {
          return response.status(413).json({
            error: 'PAYLOAD_TOO_LARGE',
            code: error.code,
            message: error.message,
            details: error.details
          })
        } else if (statusCode === 415) {
          return response.status(415).json({
            error: 'UNSUPPORTED_MEDIA_TYPE',
            code: error.code,
            message: error.message,
            details: error.details
          })
        } else if (statusCode === 422) {
          return response.validationError({
            error: 'VALIDATION_FAILED',
            code: error.code,
            message: error.message,
            details: error.details
          })
        } else {
          return response.badRequest({
            error: 'MULTIPART_ERROR',
            code: error.code,
            message: error.message,
            details: error.details
          })
        }
      }

      return response.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to process multipart data',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

export default multipartPlugin