import type { Runtime } from '@asterflow/adapter'
import type { AnyAsterflow } from 'asterflow'
import type { Responders } from '@asterflow/response'
import type {
  AnySchema,
  MethodHandler, MethodKeys,
  Middleware,
  MiddlewareOutput,
  Method as OriginalMethod,
  MethodOptions,
  Router as OriginalRouter,
  RouterOptions,
  RouteHandler,
  SchemaDynamic
} from '@asterflow/router'

declare module '@asterflow/router' {
  type MethodOptionsFS<
   Responder extends Responders,
   Path extends string = string,
   Drive extends Runtime = Runtime,
   Method extends MethodKeys = MethodKeys,
   Schema extends AnySchema = AnySchema,
   Middlewares extends readonly Middleware<Responder, Schema, string, Record<string, unknown>>[] = [],
   Context extends MiddlewareOutput<Middlewares> = MiddlewareOutput<Middlewares>,
   Instance extends AnyAsterflow = AnyAsterflow,
   Handler extends MethodHandler<Path, Drive, Responder, Schema, Middlewares, Context, Instance> = MethodHandler<Path, Drive, Responder, Schema, Middlewares, Context, Instance>,
  > = Omit<MethodOptions<Responder, Path, Drive, Method, Schema, Middlewares, Context, Instance, Handler>, 'path'> 
    & {
      path?: Path
      param?: Path
    }

  type RouterOptionsFS<
    Path extends string,
    Schema extends SchemaDynamic<MethodKeys>,
    Responder extends Responders,
    Middlewares extends readonly Middleware<Responder, AnySchema, string, Record<string, unknown>>[],
    Context extends MiddlewareOutput<Middlewares>,
    Routers extends {
      [Method in MethodKeys]?: RouteHandler<Path, Responder, Method, Schema, Middlewares, Context>;
    }
  > = Omit<RouterOptions<Path, Schema, Responder, Middlewares, Context, Routers>, 'path'> 
    & {
      path?: Path
      param?: Path
    }

  export class Method<
  Responder extends Responders,
   const Path extends string = string,
   const Drive extends Runtime = Runtime,
   const Method extends MethodKeys = MethodKeys,
   const Schema extends AnySchema = AnySchema,
   const Middlewares extends readonly Middleware<Responder, Schema, string, Record<string, unknown>>[] = [],
   const Context extends MiddlewareOutput<Middlewares> = MiddlewareOutput<Middlewares>,
   const Instance extends AnyAsterflow = AnyAsterflow,
   const Handler extends MethodHandler<Path, Drive, Responder, Schema, Middlewares, Context, Instance> = MethodHandler<Path, Drive, Responder, Schema, Middlewares, Context, Instance>,
  > extends OriginalMethod<Responder, Path, Drive, Method, Schema, Middlewares, Context, Instance, Handler> {
    constructor(options: MethodOptionsFS<Responder, Path, Drive, Method, Schema, Middlewares, Context, Instance, Handler>)
  }

  export class Router<
    Responder extends Responders,
    const Path extends string = string,
    const Schema extends SchemaDynamic<MethodKeys> = SchemaDynamic<MethodKeys>,
    const Middlewares extends readonly Middleware<Responder, AnySchema, string, Record<string, unknown>>[] = [],
    const Context extends MiddlewareOutput<Middlewares> = MiddlewareOutput<Middlewares>,
    const Routers extends {
      [Method in MethodKeys]?: RouteHandler<Path, Responder, Method, Schema, Middlewares, Context>;
    } = {
      [Method in MethodKeys]?: RouteHandler<Path, Responder, Method, Schema, Middlewares, Context>;
    }
  > extends OriginalRouter<Responder, Path, Schema, Middlewares, Context, Routers> {
    constructor(options: RouterOptionsFS<Path, Schema, Responder, Middlewares, Context, Routers>)
  }
}