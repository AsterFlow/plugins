# AsterFlow Official Plugins

This directory contains official plugins maintained by the AsterFlow team. These plugins extend the core functionality of the framework, providing features like file system-based routing, authentication, and more, all while maintaining the type safety and modularity you expect from AsterFlow.

## 📦 Available Plugins

| Plugin | Version | Description |
| ------ |-------- | ----------- |
| [@asterflow/fs](https://github.com/AsterFlow/plugins/tree/main/plugins/fs) | [![npm version](https://img.shields.io/npm/v/@asterflow/fs.svg?style=flat-square)](https://www.npmjs.com/package/@asterflow/fs) | Adds file system convention-based routing. |

## 🚀 How to Use a Plugin

Plugins are integrated into your AsterFlow application using the `.use()` method. Each plugin may require its own specific configuration.

Here is a general example of how to register and configure a plugin:

```typescript
import { AsterFlow } from 'asterflow';
import { fsRouting } from '@asterflow/fs';
import { join } from 'path';

// Register the plugin with its required configuration
export const app = new AsterFlow();
  .use(fsRouting, {
  path: join(process.cwd(), 'routes') // The directory where your routes are located
});

// Start your server
app.listen({ port: 3333 });
```

For detailed instructions, please refer to the `README.md` file within each plugin's directory.

## ✨ Creating Your Own Plugin

The AsterFlow plugin system is designed to be simple and extensible. You can easily create your own plugins to encapsulate and reuse logic across your projects.

Here is a quick overview of the plugin creation API:

```typescript
import { Plugin } from '@asterflow/plugin';
import type { AsterFlow } from 'asterflow';

// It's good practice to type the AsterFlow instance
const myPlugin = Plugin.instance<AsterFlow>()
  .create({ name: 'my-first-plugin' })
  .decorate('appName', 'My Awesome App') // Adds static values to the context
  .config({ enabled: true }) // Defines the plugin's configuration
  .on('beforeInitialize', (app, context) => {
    // `app` is the AsterFlow instance
    // `context` is the typed plugin context ({ appName: string, enabled: boolean })
    if (context.enabled) {
      console.log(`Initializing ${context.appName}...`);
    }
  });

// Now you can use it: app.use(myPlugin, { enabled: false });
```

For a complete guide on creating plugins, see the [`@asterflow/plugin`](https://www.google.com/search?q=%5Bhttps://www.npmjs.com/package/%40asterflow/plugin%5D\(https://www.npmjs.com/package/%40asterflow/plugin\)) package documentation.