import type { BusboyMultipartParser } from '../controllers/busboy'

declare module '@asterflow/request' {
    interface AsterRequest {
      multipart: BusboyProcessedFile
  }
}