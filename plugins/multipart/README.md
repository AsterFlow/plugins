<div align="center">

# @asterflow/multipart

![license-info](https://img.shields.io/github/license/AsterFlow/plugins?style=for-the-badge&colorA=302D41&colorB=f9e2af&logoColor=f9e2af)
![stars-info](https://img.shields.io/github/stars/AsterFlow/plugins?colorA=302D41&colorB=f9e2af&style=for-the-badge)
![bundle-size](https://img.shields.io/bundlejs/size/@asterflow/multipart?style=for-the-badge&colorA=302D41&colorB=3ac97b)

</div>

> Multipart form data parsing plugin for AsterFlow.

## 📦 Installation

```bash
# You can use any package manager
npm install @asterflow/multipart
```

## 💡 About

`@asterflow/multipart` provides robust multipart form data parsing capabilities for your AsterFlow projects. Built on top of Busboy, this plugin automatically processes file uploads and form fields, making it easy to handle complex form submissions with file attachments.

## ✨ Features

  - **Automatic Processing:** Automatically detects and processes multipart/form-data requests.
  - **File Upload Support:** Handle file uploads with configurable size limits and validation.
  - **Memory & Disk Storage:** Choose between in-memory storage or temporary file storage.
  - **Validation:** Built-in MIME type and file extension validation.
  - **Type-Safe:** Fully integrated with AsterFlow's type system.
  - **Event-Driven:** Monitor upload progress and handle events.

## 🚀 Quick Start

```typescript
import { AsterFlow } from 'asterflow';
import { multipartPlugin } from '@asterflow/multipart';

const app = new AsterFlow()
  .use(multipartPlugin)
  .listen({ port: 3333 });
```

## 📖 Usage

### 1. Register the Plugin

In your main application file, import and register the `multipartPlugin`.

**`src/index.ts`**

```typescript
import { AsterFlow } from 'asterflow';
import { multipartPlugin } from '@asterflow/multipart';

export const app = new AsterFlow()
  .use(multipartPlugin, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 5
    },
  });

// Start the server
app.listen({ port: 3333 }, () => {
  console.log('Server running with multipart support!');
});
```

### 2. Usage Examples

#### Basic File Upload

**`src/routes/upload.ts`**

```typescript
import { Method } from '@asterflow/router'

export default new Method({
  method: 'post',
  async handler({ request, response }) {
    // Get a specific file by field name
    const avatar = request.multipart.getFile('avatar')
    if (!avatar) return response.badRequest({ error: 'No file uploaded' })

    // Save the file
    await avatar.save(`./uploads/${avatar.filename}`)

    return response.success({
      message: 'File uploaded successfully',
      file: {
        name: avatar.filename,
        size: avatar.size,
        type: avatar.mimeType
      }
    })
  }
})
```

#### Advanced Upload with Metadata

Handle multiple files with full metadata and error handling.

**`src/routes/upload-advanced.ts`**

```ts
import { Method } from '@asterflow/router'

export default new Method({
  method: 'post',
  async handler({ request, response }) {
    const multipart = request.multipart
    
    // Check if there are files in the request
    if (!multipart.hasFiles()) {
      return response.badRequest({
        error: 'NO_FILES',
        message: 'No files have been uploaded',
        fields: multipart.fields,
      })
    }
    
    try {
      // Save all files to the uploads directory
      const savedPaths = await multipart.saveAll('./uploads')
      
      return response.status(200).json({
        message: 'Upload completed successfully!',
        metadata: {
          filesCount: multipart.files.length,
          fieldsCount: Object.keys(multipart.fields).length,
          totalSize: multipart.metadata.totalSize,
          processingTime: multipart.metadata.processingTime
        },
        files: multipart.files.map((file: any) => ({
          fieldName: file.fieldName,
          filename: file.filename,
          size: file.size,
          mimeType: file.mimeType,
          extension: file.extension
        })),
        fields: multipart.fields,
        savedPaths
      })
    } catch (error) {
      return response.status(500).json({
        message: 'Error saving files',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
})
```

### 3. Configuration Options

Configure the plugin with custom settings for your needs.

```typescript
app.use(multipartPlugin, {
  limits: {
    fieldNameSize: 100,
    fieldSize: 1024 * 1024, // 1MB for form fields
    fields: Infinity,
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 10, // Max 10 files
    parts: Infinity
  },
  fileHandling: {
    keepInMemory: false, // Use temporary files
    tempDir: './temp'
  },
  validation: {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf'],
    validator: async (file) => {
      // Custom validation logic
        const fileSize = file.size || 0
        return fileSize < 10 * 1024 * 1024; // 10MB
    }
  }
});
```

## 🗺️ API Reference

### Request Extensions

When a multipart request is processed, the request object is extended with:

- `request.files` - Array of uploaded files
- `request.multipart` - Multipart utilities object

### Multipart Utilities

The `request.multipart` object provides:

- `getFile(fieldName: string)` - Get a specific file by field name
- `getFiles(fieldName?: string)` - Get all files or files by field name
- `hasFiles()` - Check if any files were uploaded
- `getFilesByType(mimeType: string)` - Get files by MIME type
- `saveAll(directory: string)` - Save all files to a directory

### File Object

Each uploaded file has the following properties and methods:

```typescript
interface ProcessedFile {
  fieldName: string;    // Form field name
  filename: string;     // Original filename
  encoding: string;     // File encoding
  mimeType: string;     // MIME type
  size: number;         // File size in bytes
  buffer?: Buffer;      // File buffer (if keepInMemory = true)
  tempPath?: string;    // Temporary file path (if keepInMemory = false)
  extension?: string;   // File extension
  
  // Methods
  toBuffer(): Promise<Buffer>;
  save(path: string): Promise<void>;
  stream(): NodeJS.ReadableStream;
}
```

### Configuration Options

```typescript
interface MultipartConfig {
  limits?: {
    fieldNameSize?: number;  // Max field name size (default: 100)
    fieldSize?: number;      // Max field value size (default: 1MB)
    fields?: number;         // Max number of fields (default: Infinity)
    fileSize?: number;       // Max file size (default: 10MB)
    files?: number;          // Max number of files (default: 10)
    parts?: number;          // Max number of parts (default: Infinity)
  };
  fileHandling?: {
    keepInMemory?: boolean;  // Keep files in memory (default: true)
    tempDir?: string;        // Temp directory (default: '/tmp')
    fileHandler?: (file: MultipartFile) => Promise<ProcessedFile>;
  };
  validation?: {
    allowedMimeTypes?: string[];  // Allowed MIME types
    allowedExtensions?: string[]; // Allowed file extensions
    validator?: (file: MultipartFile) => boolean | Promise<boolean>;
  };
}
```

## 🔗 Related Packages

  - [asterflow](https://www.npmjs.com/package/asterflow) - The core of the AsterFlow framework.
  - [@asterflow/plugin](https://www.npmjs.com/package/@asterflow/plugin) - The main plugin system.
  - [@asterflow/router](https://www.npmjs.com/package/@asterflow/router) - The type-safe routing system.

## 📄 License

MIT - See the main project [LICENSE](https://github.com/AsterFlow/AsterFlow/blob/main/LICENSE) for more details.