/**
 * Interface for multipart plugin configuration
 */
export interface MultipartConfig {
  /** Configuration limits for processing */
  limits?: {
    /** Maximum field name size in bytes (default: 100) */
    fieldNameSize?: number;
    /** Maximum field value size in bytes (default: 1MB) */
    fieldSize?: number;
    /** Maximum number of fields (default: Infinity) */
    fields?: number;
    /** Maximum file size in bytes (default: 10MB) */
    fileSize?: number;
    /** Maximum number of files (default: 10) */
    files?: number;
    /** Maximum number of parts (default: Infinity) */
    parts?: number;
  };
  
  /** File processing configuration */
  fileHandling?: {
    /** Whether to keep files in memory as Buffer */
    keepInMemory?: boolean;
    /** Temporary directory to save files (if not in memory) */
    tempDir?: string;
    /** Custom function to process file streams */
    fileHandler?: (file: MultipartFile) => Promise<ProcessedFile>;
  };
  
  /** Validation configuration */
  validation?: {
    /** Allowed MIME types */
    allowedMimeTypes?: string[];
    /** Allowed file extensions */
    allowedExtensions?: string[];
    /** Custom validation function */
    validator?: (file: MultipartFile) => boolean | Promise<boolean>;
  };
}

/**
 * Interface to represent a file during processing
 */
export interface MultipartFile {
  /** Field name in the form */
  fieldName: string;
  /** Original filename */
  filename: string;
  /** File encoding */
  encoding: string;
  /** File MIME type */
  mimeType: string;
  /** File stream */
  stream: NodeJS.ReadableStream;
  /** File size in bytes (if available) */
  size?: number;
}

/**
 * Interface to represent a processed file
 */
export interface ProcessedFile {
  /** Field name in the form */
  fieldName: string;
  /** Original filename */
  filename: string;
  /** File encoding */
  encoding: string;
  /** File MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** File buffer (if keepInMemory = true) */
  buffer?: Buffer;
  /** Temporary file path (if keepInMemory = false) */
  tempPath?: string;
  /** File extension */
  extension?: string;
  
  /** Utility methods */
  toBuffer(): Promise<Buffer>;
  save(path: string): Promise<void>;
  stream(): NodeJS.ReadableStream;
}

/**
 * Interface for multipart processing result
 */
export interface MultipartResult {
  /** Text fields from the form */
  fields: Record<string, string | string[]>;
  /** Processed files */
  files: ProcessedFile[];
  /** Processing metadata */
  metadata: {
    /** Total processing time in ms */
    processingTime: number;
    /** Total size of processed data */
    totalSize: number;
    /** Number of processed fields */
    fieldsCount: number;
    /** Number of processed files */
    filesCount: number;
  };
}

/**
 * Interface for parser events
 */
export interface ParserEvents {
  onFieldStart?: (fieldName: string) => void;
  onField?: (fieldName: string, value: string) => void;
  onFileStart?: (file: MultipartFile) => void;
  onFileData?: (file: MultipartFile, chunk: Buffer) => void;
  onFileEnd?: (file: ProcessedFile) => void;
  onProgress?: (bytesReceived: number, totalBytes?: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Custom error for multipart issues
 */
export class MultipartError extends Error {
  code: string
  details?: any

  constructor(message: string, code: string, details?: any) {
    super(message)
    this.name = 'MultipartError'
    this.code = code
    this.details = details
  }
}

/**
 * Multipart error codes
 */
export const MultipartErrorCodes = {
  LIMIT_FILE_SIZE: 'LIMIT_FILE_SIZE',
  LIMIT_FILE_COUNT: 'LIMIT_FILE_COUNT',
  LIMIT_FIELD_SIZE: 'LIMIT_FIELD_SIZE',
  LIMIT_FIELD_COUNT: 'LIMIT_FIELD_COUNT',
  LIMIT_PARTS: 'LIMIT_PARTS',
  INVALID_MIME_TYPE: 'INVALID_MIME_TYPE',
  INVALID_EXTENSION: 'INVALID_EXTENSION',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PARSE_ERROR: 'PARSE_ERROR'
} as const

export type MultipartErrorCode = typeof MultipartErrorCodes[keyof typeof MultipartErrorCodes];
